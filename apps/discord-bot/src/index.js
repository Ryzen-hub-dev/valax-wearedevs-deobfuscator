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

const config = loadConfig();
const cooldowns = new CooldownStore(config.cooldownMs);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

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

async function recoverSource(input) {
  const response = await fetch(`${config.apiUrl}/api/recovery`, {
    method: 'POST',
    signal: AbortSignal.timeout(300_000),
    headers: {
      'Authorization': `Bearer ${config.apiSecret}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ source: input.source, filename: input.filename, stage: 'L5' })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `Recovery API returned HTTP ${response.status}.`);
  }
  return data;
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
});

client.on(Events.PresenceUpdate, async (_oldPresence, newPresence) => {
  if (newPresence.guild?.id !== config.guildId) return;
  const member = newPresence.member || await newPresence.guild.members.fetch(newPresence.userId).catch(() => null);
  if (member) await syncSupporterRole(member, newPresence);
});

client.on(Events.InteractionCreate, async interaction => {
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
    const result = await recoverSource(input);
    const outputName = `deobfuscated-${sanitizeFilename(input.filename)}`;
    const file = new AttachmentBuilder(Buffer.from(result.code, 'utf8'), { name: outputName });
    const level = result.report?.recoveryLevel || 'unknown';
    const confidence = Number.isFinite(result.report?.confidence)
      ? `${Math.round(result.report.confidence * 100)}%`
      : 'unknown';

    await interaction.editReply({
      content: `Recovery complete — level **${level}**, confidence **${confidence}**.`,
      files: [file]
    });
  } catch (error) {
    if (!admin) cooldowns.clear(interaction.user.id);
    await interaction.editReply({ content: `Recovery failed: ${error.message}` });
  }
});

process.on('unhandledRejection', error => console.error('Unhandled rejection:', error));
process.on('SIGTERM', () => client.destroy());
process.on('SIGINT', () => client.destroy());

client.login(config.token);

module.exports = { isAdministrator, recoverSource, resolveInput, sanitizeFilename, syncSupporterRole };
