require('./env');

const fs = require('fs');
const path = require('path');
const {
  ChannelType,
  Client,
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
      RADIO_STREAM_URL: 'http://streaming.exclusive.radio/er/billyeilish/icecast.audio'
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
