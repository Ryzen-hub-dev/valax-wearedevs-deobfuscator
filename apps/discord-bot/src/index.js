require('./env');

const {
  AttachmentBuilder,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');
const { loadConfig } = require('./config');
const { CooldownStore, formatRemaining, hasSupportStatus } = require('./access');
const { fetchSource } = require('./safe-fetch');
const { hostedFallbackStages, recoverInWorker } = require('./worker-client');
const { VoiceService } = require('./voice-service');
const { CommunityStore } = require('./community-store');
const { CommunityService } = require('./community-service');
const { CommunityDashboard } = require('./community-dashboard');

const config = loadConfig();
const cooldowns = new CooldownStore(config.cooldownMs);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates
  ]
});
const voiceService = new VoiceService(client, config);
const communityStore = new CommunityStore(config.communityDataPath);
const communityService = new CommunityService(client, config, communityStore);
const communityDashboard = new CommunityDashboard(client, config, communityStore);

function isAdministrator(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || false;
}

function sanitizeFilename(filename) {
  const safe = String(filename || 'script.lua').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return safe || 'script.lua';
}

async function syncSupporterRole(member, presence = member.presence) {
  if (!member || member.user?.bot) return;
  const shouldHaveRole = hasSupportStatus(presence, config.statusText);
  const hasRole = member.roles.cache.has(config.supporterRoleId);
  if (shouldHaveRole === hasRole) return;

  try {
    if (shouldHaveRole) {
      await member.roles.add(config.supporterRoleId, `Custom status contains: ${config.statusText}`);
    } else {
      await member.roles.remove(config.supporterRoleId, `Custom status no longer contains: ${config.statusText}`);
    }
  } catch (error) {
    console.error(`Unable to update supporter role for ${member.id}: ${error.message}`);
  }
}

async function resolveInput(interaction) {
  const link = interaction.options.getString('link');
  const attachment = interaction.options.getAttachment('file');
  const pasted = interaction.options.getString('paste');
  const selected = [link, attachment, pasted].filter(Boolean);
  if (selected.length !== 1) {
    throw new Error('Choose exactly one input: `link`, `file`, or `paste`.');
  }

  if (link) return fetchSource(link, config.maxSourceBytes);
  if (attachment) {
    if (attachment.size > config.maxSourceBytes) {
      throw new Error(`The attached file is larger than ${config.maxSourceBytes} bytes.`);
    }
    return fetchSource(attachment.url, config.maxSourceBytes);
  }

  if (Buffer.byteLength(pasted, 'utf8') > config.maxSourceBytes) {
    throw new Error(`The pasted source is larger than ${config.maxSourceBytes} bytes.`);
  }
  return { source: pasted, filename: 'pasted-script.lua' };
}

async function recoverViaApi(input, stage = 'L5') {
  let response;
  try {
    response = await fetch(`${config.apiUrl}/api/recovery`, {
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
      headers: {
        'Authorization': `Bearer ${config.apiSecret}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ source: input.source, filename: input.filename, stage })
    });
  } catch (error) {
    if (error.name === 'TimeoutError') error.code = 'HOSTED_RESOURCE_LIMIT';
    throw error;
  }

  const rawBody = await response.text();
  let data = null;
  try {
    data = JSON.parse(rawBody);
  } catch {}

  if (!response.ok || !data?.success) {
    const code = data?.code ? ` [${data.code}]` : '';
    const requestId = response.headers.get('x-vercel-id');
    const requestSuffix = requestId ? ` Request: ${requestId}.` : '';
    const fallbackMessage = response.status >= 500
      ? 'The hosted recovery process exhausted its time or memory budget.'
      : `Recovery API returned HTTP ${response.status}.`;
    const error = new Error(`${data?.error || fallbackMessage}${code}${requestSuffix}`);
    error.code = response.status >= 500 ? 'HOSTED_RESOURCE_LIMIT' : (data?.code || 'RECOVERY_API_ERROR');
    throw error;
  }
  return data;
}

async function recoverSource(input) {
  if (!config.localRecovery) return recoverViaApi(input);

  try {
    return await recoverInWorker(input, config);
  } catch (error) {
    const fallbackCodes = new Set([
      'WORKER_UNAVAILABLE',
      'WORKER_RESOURCE_LIMIT',
      'WORKER_TIMEOUT',
      'WORKER_INVALID_RESPONSE',
      'WORKER_OUTPUT_LIMIT'
    ]);
    if (!fallbackCodes.has(error.code)) throw error;

    const stages = hostedFallbackStages(error.code);
    console.error(`Local recovery failed (${error.code}): ${error.message}`);
    let result;
    let fallbackStage;
    for (let index = 0; index < stages.length; index += 1) {
      fallbackStage = stages[index];
      try {
        console.error(`Trying hosted ${fallbackStage} recovery.`);
        result = await recoverViaApi(input, fallbackStage);
        break;
      } catch (hostedError) {
        const canDowngrade = hostedError.code === 'HOSTED_RESOURCE_LIMIT' && index < stages.length - 1;
        if (!canDowngrade) throw hostedError;
        console.error(`Hosted ${fallbackStage} exceeded its resource budget; downgrading.`);
      }
    }
    const report = result.report && typeof result.report === 'object' ? result.report : {};
    const warnings = Array.isArray(report.warnings) ? report.warnings : [];
    return {
      ...result,
      report: {
        ...report,
        warnings: [
          ...warnings,
          `Local L5 recovery failed (${error.code}); hosted recovery continued at ${fallbackStage}.`
        ],
        execution: {
          ...(report.execution || {}),
          requestedStage: 'L5',
          executedStage: report.execution?.executedStage || fallbackStage,
          fallbackStage,
          localFailureCode: error.code
        }
      }
    };
  }
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`Valax Discord bot logged in as ${readyClient.user.tag}.`);
  const guild = readyClient.guilds.cache.get(config.guildId);
  if (!guild) {
    console.error(`Configured guild ${config.guildId} is not available to this bot.`);
    return;
  }

  try {
    const members = await guild.members.fetch({ withPresences: true });
    await Promise.allSettled(members.map(member => syncSupporterRole(member)));
    console.log(`Reconciled support status access for ${members.size} members.`);
  } catch (error) {
    console.error(`Initial presence reconciliation failed: ${error.message}`);
  }

  try {
    await voiceService.start(guild);
  } catch (error) {
    console.error(`Discord voice service failed to start: ${error.message}`);
  }

  try {
    await communityService.start(guild);
    await communityDashboard.start(guild);
  } catch (error) {
    communityStore.recordSystemError();
    console.error(`Discord community service failed to start: ${error.message}`);
  }
});

client.on(Events.PresenceUpdate, async (_oldPresence, newPresence) => {
  if (newPresence.guild?.id !== config.guildId) return;
  const member = newPresence.member || await newPresence.guild.members.fetch(newPresence.userId).catch(() => null);
  if (member) await syncSupporterRole(member, newPresence);
});

client.on(Events.GuildMemberAdd, member => voiceService.handleMemberAdd(member));
client.on(Events.GuildMemberRemove, member => voiceService.handleMemberRemove(member));
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  voiceService.handleVoiceStateUpdate(oldState, newState);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (await communityService.handleInteraction(interaction)) return;
  } catch (error) {
    communityStore.recordSystemError();
    console.error(`Community interaction failed: ${error.stack || error.message}`);
    const response = { content: 'That community action failed. Staff have been notified in the control-center health counter.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: response.content }).catch(() => {});
    else await interaction.reply(response).catch(() => {});
    return;
  }
  if (!interaction.isChatInputCommand() || interaction.commandName !== '1') return;
  const admin = isAdministrator(interaction);

  if (interaction.guildId !== config.guildId || interaction.channelId !== config.channelId) {
    return interaction.reply({ content: `Use this command only in <#${config.channelId}>.`, flags: MessageFlags.Ephemeral });
  }

  if (!admin && !interaction.member.roles.cache.has(config.supporterRoleId)) {
    return interaction.reply({
      content: `Set your custom status to \`${config.statusText}\`, then wait a few seconds for access.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const remaining = admin ? 0 : cooldowns.remaining(interaction.user.id);
  if (remaining > 0) {
    return interaction.reply({
      content: `You can use /1 again in ${formatRemaining(remaining)}.`,
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!admin) cooldowns.start(interaction.user.id);

  try {
    const input = await resolveInput(interaction);
    console.info('Discord recovery request', {
      filename: input.filename,
      sourceBytes: Buffer.byteLength(input.source, 'utf8'),
      userId: interaction.user.id
    });
    const result = await recoverSource(input);
    const outputName = `deobfuscated-${sanitizeFilename(input.filename)}`;
    const file = new AttachmentBuilder(Buffer.from(result.code, 'utf8'), { name: outputName });
    const reportFile = new AttachmentBuilder(
      Buffer.from(JSON.stringify(result.report || {}, null, 2), 'utf8'),
      { name: 'recovery-report.json' }
    );
    const level = result.report?.recoveryLevel || 'unknown';
    const requestedStage = result.report?.execution?.requestedStage || 'L5';
    const executedStage = result.report?.execution?.executedStage || requestedStage;
    const stageNote = executedStage !== requestedStage
      ? `, engine stage **${executedStage}** (automatically limited for stability)`
      : `, engine stage **${executedStage}**`;
    const confidence = Number.isFinite(result.report?.confidence)
      ? `${Math.round(result.report.confidence * 100)}%`
      : 'unknown';

    await interaction.editReply({
      content: `Recovery complete — level **${level}**${stageNote}, confidence **${confidence}**.`,
      files: [file, reportFile]
    });
  } catch (error) {
    if (!admin) cooldowns.clear(interaction.user.id);
    await interaction.editReply({ content: `Recovery failed: ${error.message}` });
  }
});

process.on('unhandledRejection', error => console.error('Unhandled rejection:', error));
process.on('SIGTERM', () => {
  communityDashboard.stop();
  communityService.stop();
  voiceService.stop();
  client.destroy();
});
process.on('SIGINT', () => {
  communityDashboard.stop();
  communityService.stop();
  voiceService.stop();
  client.destroy();
});

client.login(config.token);

module.exports = { isAdministrator, recoverSource, recoverViaApi, resolveInput, sanitizeFilename, syncSupporterRole };
