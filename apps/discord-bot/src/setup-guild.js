require('./env');

const fs = require('fs');
const path = require('path');
const {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits
} = require('discord.js');

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const configuredChannelId = process.env.DEOBFUSCATE_CHANNEL_ID;

if (!token || !guildId) {
  throw new Error('DISCORD_BOT_TOKEN and DISCORD_GUILD_ID are required.');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

function saveLocalIds(values) {
  const envPath = path.resolve(__dirname, '../../../.env.bot.local');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}="${value}"`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    content = pattern.test(content)
      ? content.replace(pattern, line)
      : `${content.replace(/\s*$/, '')}\n${line}\n`;
  }

  fs.writeFileSync(envPath, content, { encoding: 'utf8', mode: 0o600 });
}

client.once(Events.ClientReady, async () => {
  try {
    const availableGuilds = await client.guilds.fetch();
    const guildReference = availableGuilds.get(guildId);
    if (!guildReference) {
      const visibleGuilds = availableGuilds.size > 0
        ? availableGuilds.map(item => `${item.name} (${item.id})`).join(', ')
        : 'none';
      throw new Error(`Configured guild ${guildId} is unavailable. Bot-accessible guilds: ${visibleGuilds}`);
    }

    const guild = await guildReference.fetch();
    const botMember = await guild.members.fetchMe();
    const requiredPermissions = [
      [PermissionFlagsBits.ManageRoles, 'Manage Roles'],
      [PermissionFlagsBits.ManageChannels, 'Manage Channels'],
      [PermissionFlagsBits.MoveMembers, 'Move Members'],
      [PermissionFlagsBits.Connect, 'Connect'],
      [PermissionFlagsBits.Speak, 'Speak']
    ];
    const missingPermissions = requiredPermissions
      .filter(([permission]) => !botMember.permissions.has(permission))
      .map(([, name]) => name);
    if (missingPermissions.length > 0) {
      throw new Error(`Bot is missing server permissions: ${missingPermissions.join(', ')}`);
    }

    await guild.roles.fetch();
    await guild.channels.fetch();

    let role = guild.roles.cache.find(item => item.name === 'Valax Supporter');
    if (!role) {
      role = await guild.roles.create({
        name: 'Valax Supporter',
        color: 0x5865F2,
        reason: 'Valax support-status access role'
      });
    }

    let channel = configuredChannelId
      ? guild.channels.cache.get(configuredChannelId)
      : guild.channels.cache.find(item =>
        item.type === ChannelType.GuildText && item.name === 'deobfuscate'
      );

    if (configuredChannelId && !channel) {
      throw new Error(`Configured channel ${configuredChannelId} was not found in guild ${guildId}.`);
    }
    if (channel && channel.type !== ChannelType.GuildText) {
      throw new Error(`Configured channel ${channel.id} is not a guild text channel.`);
    }

    const permissionOverwrites = [
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ManageChannels
        ]
      },
      {
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.UseApplicationCommands
        ]
      },
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      }
    ];

    if (!channel) {
      channel = await guild.channels.create({
        name: 'deobfuscate',
        type: ChannelType.GuildText,
        topic: 'Set your custom status to “support valaxscrub.shop”, then use /1.',
        rateLimitPerUser: 1200,
        permissionOverwrites,
        reason: 'Valax deobfuscation channel setup'
      });
    } else {
      for (const overwrite of permissionOverwrites) {
        await channel.permissionOverwrites.edit(overwrite.id, {
          ViewChannel: overwrite.deny ? false : true,
          ...(overwrite.id === role.id ? {
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            UseApplicationCommands: true
          } : {}),
          ...(overwrite.id === client.user.id ? {
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            ManageChannels: true
          } : {})
        }, { reason: 'Valax deobfuscation channel setup' });
      }
      await channel.edit({
        topic: 'Set your custom status to “support valaxscrub.shop”, then use /1.',
        rateLimitPerUser: 1200,
        reason: 'Valax deobfuscation channel setup'
      });
    }

    let verifiedRole = guild.roles.cache.find(item => item.name === 'Valax Verified');
    if (!verifiedRole) {
      verifiedRole = await guild.roles.create({
        name: 'Valax Verified',
        color: 0x57F287,
        reason: 'Completed voice onboarding role'
      });
    }

    let staffRole = guild.roles.cache.find(item => item.name === 'Valax Staff');
    if (!staffRole) {
      staffRole = await guild.roles.create({
        name: 'Valax Staff',
        color: 0xA78BFA,
        hoist: true,
        mentionable: false,
        reason: 'Valax community staff role'
      });
    }

    async function ensureCategory(name, overwrites, reason) {
      let category = guild.channels.cache.find(item =>
        item.type === ChannelType.GuildCategory && item.name.toLowerCase() === name.toLowerCase()
      );
      if (!category) {
        category = await guild.channels.create({
          name,
          type: ChannelType.GuildCategory,
          permissionOverwrites: overwrites,
          reason
        });
      } else {
        await category.permissionOverwrites.set(overwrites, reason);
      }
      return category;
    }

    async function ensureTextChannel(name, parent, topic, reason) {
      let textChannel = guild.channels.cache.find(item =>
        item.type === ChannelType.GuildText && item.name === name
      );
      if (!textChannel) {
        textChannel = await guild.channels.create({
          name,
          type: ChannelType.GuildText,
          parent: parent.id,
          topic,
          reason
        });
      } else {
        await textChannel.edit({ parent: parent.id, topic, reason });
      }
      return textChannel;
    }

    const communityCategory = await ensureCategory('VALAX COMMUNITY', [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: verifiedRole.id, allow: [PermissionFlagsBits.ViewChannel] },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels
        ]
      }
    ], 'Valax premium community category');
    const communityHubChannel = await ensureTextChannel(
      'community-hub',
      communityCategory,
      'Valax server information, economy, applications and support commands.',
      'Valax premium community hub'
    );
    const giveawayChannel = await ensureTextChannel(
      'giveaways',
      communityCategory,
      'Quick drops and community rewards published by Valax staff.',
      'Valax premium reward drops'
    );
    const countingChannel = await ensureTextChannel(
      'counting',
      communityCategory,
      'Count upward one number at a time. The same member cannot count twice in a row.',
      'Valax community counting game'
    );

    const ticketsCategory = await ensureCategory('VALAX TICKETS', [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel] },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels
        ]
      }
    ], 'Valax private support tickets');

    const operationsCategory = await ensureCategory('VALAX OPERATIONS', [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: staffRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels
        ]
      }
    ], 'Valax private staff operations');
    const applicationsChannel = await ensureTextChannel(
      'staff-applications',
      operationsCategory,
      'Private staff application review queue.',
      'Valax application review queue'
    );
    const loaChannel = await ensureTextChannel(
      'leave-requests',
      operationsCategory,
      'Private leave-of-absence review queue.',
      'Valax leave request queue'
    );
    const communityLogChannel = await ensureTextChannel(
      'community-logs',
      operationsCategory,
      'Operational events and community automation logs.',
      'Valax community logs'
    );

    const hubEmbed = new EmbedBuilder()
      .setColor(0x7C3AED)
      .setTitle('✦ Welcome to Valax')
      .setDescription('Your access is active. Use the commands below for support, rewards, staff applications and community progress.')
      .addFields(
        { name: 'Support', value: '`/ticket` private help\n`/1` Lua/Luau recovery\n`/about` server information', inline: true },
        { name: 'Community', value: '`/daily` coin reward\n`/level` activity level\n`/leaderboard` economy ranking', inline: true },
        { name: 'Programs', value: '`/apply` staff application\n`/invites` invite milestones\n`/counting-status` counting game', inline: true }
      )
      .setFooter({ text: 'VALAX COMMUNITY HUB' });
    const recentHubMessages = await communityHubChannel.messages.fetch({ limit: 50 }).catch(() => null);
    const existingHubPanel = recentHubMessages?.find(message =>
      message.author.id === client.user.id && message.embeds[0]?.footer?.text === 'VALAX COMMUNITY HUB'
    );
    if (existingHubPanel) await existingHubPanel.edit({ embeds: [hubEmbed] });
    else await communityHubChannel.send({ embeds: [hubEmbed] });

    let onboardingCategory = guild.channels.cache.find(item =>
      item.type === ChannelType.GuildCategory && item.name === 'Start Here'
    );
    const onboardingOverwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.MoveMembers,
          PermissionFlagsBits.ManageChannels
        ]
      }
    ];
    if (!onboardingCategory) {
      onboardingCategory = await guild.channels.create({
        name: 'Start Here',
        type: ChannelType.GuildCategory,
        permissionOverwrites: onboardingOverwrites,
        reason: 'Private voice onboarding category'
      });
    } else {
      await onboardingCategory.permissionOverwrites.edit(guild.roles.everyone.id, {
        ViewChannel: false,
        Connect: false
      });
      await onboardingCategory.permissionOverwrites.edit(client.user.id, {
        ViewChannel: true,
        Connect: true,
        Speak: true,
        MoveMembers: true,
        ManageChannels: true
      });
    }

    let afkChannel = guild.channels.cache.find(item =>
      item.type === ChannelType.GuildVoice && item.name.toLowerCase() === 'afk'
    );
    if (!afkChannel) {
      afkChannel = await guild.channels.create({
        name: 'AFK',
        type: ChannelType.GuildVoice,
        reason: 'Valax 24/7 radio voice channel'
      });
    }

    const members = await guild.members.fetch();
    const nonAdminBots = members.filter(member =>
      member.user.bot && !member.permissions.has(PermissionFlagsBits.Administrator)
    );
    let backfilledMembers = 0;
    for (const member of members.values()) {
      if (
        member.user.bot ||
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        member.roles.cache.has(verifiedRole.id)
      ) continue;
      await member.roles.add(verifiedRole, 'Existing member access migration');
      backfilledMembers += 1;
    }

    const publicCategoryNames = new Set(['important', 'main', 'voice']);
    const publicCategories = guild.channels.cache.filter(item =>
      item.type === ChannelType.GuildCategory && publicCategoryNames.has(item.name.toLowerCase())
    );
    const protectedChannelNames = new Set(['private', 'valax-ops🤯']);
    const memberChannels = guild.channels.cache.filter(item =>
      item.id !== configuredChannelId &&
      !protectedChannelNames.has(item.name.toLowerCase()) && (
        publicCategories.has(item.id) ||
        publicCategories.has(item.parentId) ||
        (!item.parentId && item.name.startsWith('rules'))
      )
    );
    const skippedChannels = [];
    const gatedChannels = [];

    for (const memberChannel of memberChannels.values()) {
      const botPermissions = memberChannel.permissionsFor(botMember);
      if (!botPermissions?.has(PermissionFlagsBits.ViewChannel) ||
          !botPermissions.has(PermissionFlagsBits.ManageChannels)) {
        skippedChannels.push(memberChannel.name);
        continue;
      }
      await memberChannel.permissionOverwrites.edit(botMember.id, {
        ViewChannel: true,
        ManageChannels: true,
        ...(memberChannel.type === ChannelType.GuildVoice ? { Connect: true, Speak: true } : {})
      }, { reason: 'Keep onboarding bot access during permission migration' });
      await memberChannel.permissionOverwrites.edit(verifiedRole.id, { ViewChannel: true }, {
        reason: 'Unlock non-administrator channels after onboarding'
      });
      for (const botMember of nonAdminBots.values()) {
        await memberChannel.permissionOverwrites.edit(botMember.id, { ViewChannel: true }, {
          reason: 'Preserve existing bot access during onboarding migration'
        });
      }
      gatedChannels.push(memberChannel);
    }
    for (const memberChannel of gatedChannels) {
      await memberChannel.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: false }, {
        reason: 'Require completed voice onboarding'
      });
    }
    await afkChannel.permissionOverwrites.edit(client.user.id, {
      ViewChannel: true,
      Connect: true,
      Speak: true
    });

    console.log('Discord setup complete. Add these values to the bot environment:');
    console.log(`SUPPORT_ROLE_ID=${role.id}`);
    console.log(`DEOBFUSCATE_CHANNEL_ID=${channel.id}`);
    console.log(`VERIFIED_ROLE_ID=${verifiedRole.id}`);
    console.log(`ONBOARDING_CATEGORY_ID=${onboardingCategory.id}`);
    console.log(`AFK_VOICE_CHANNEL_ID=${afkChannel.id}`);
    console.log(`STAFF_ROLE_ID=${staffRole.id}`);
    console.log(`COMMUNITY_HUB_CHANNEL_ID=${communityHubChannel.id}`);
    console.log(`COUNTING_CHANNEL_ID=${countingChannel.id}`);
    console.log(`TICKETS_CATEGORY_ID=${ticketsCategory.id}`);
    console.log(`APPLICATIONS_CHANNEL_ID=${applicationsChannel.id}`);
    console.log(`LOA_CHANNEL_ID=${loaChannel.id}`);
    console.log(`GIVEAWAY_CHANNEL_ID=${giveawayChannel.id}`);
    console.log(`COMMUNITY_LOG_CHANNEL_ID=${communityLogChannel.id}`);
    console.log(`Backfilled ${backfilledMembers} existing members before gating ${gatedChannels.length} channels.`);
    if (skippedChannels.length > 0) {
      console.log(`Preserved inaccessible/admin channels: ${skippedChannels.join(', ')}`);
    }
    saveLocalIds({
      DISCORD_CLIENT_ID: client.application.id,
      DISCORD_GUILD_ID: guild.id,
      SUPPORT_ROLE_ID: role.id,
      DEOBFUSCATE_CHANNEL_ID: channel.id,
      VOICE_ENABLED: 'true',
      VERIFIED_ROLE_ID: verifiedRole.id,
      ONBOARDING_CATEGORY_ID: onboardingCategory.id,
      AFK_VOICE_CHANNEL_ID: afkChannel.id,
      RADIO_STREAM_URL: 'http://streaming.exclusive.radio/er/billyeilish/icecast.audio',
      COMMUNITY_ENABLED: 'true',
      STAFF_ROLE_ID: staffRole.id,
      COMMUNITY_HUB_CHANNEL_ID: communityHubChannel.id,
      COUNTING_CHANNEL_ID: countingChannel.id,
      TICKETS_CATEGORY_ID: ticketsCategory.id,
      APPLICATIONS_CHANNEL_ID: applicationsChannel.id,
      LOA_CHANNEL_ID: loaChannel.id,
      GIVEAWAY_CHANNEL_ID: giveawayChannel.id,
      COMMUNITY_LOG_CHANNEL_ID: communityLogChannel.id
    });
    console.log('Saved the role and channel IDs to .env.bot.local.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

client.login(token);
