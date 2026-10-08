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

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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
      [PermissionFlagsBits.ManageChannels, 'Manage Channels']
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

    console.log('Discord setup complete. Add these values to the bot environment:');
    console.log(`SUPPORT_ROLE_ID=${role.id}`);
    console.log(`DEOBFUSCATE_CHANNEL_ID=${channel.id}`);
    saveLocalIds({
      DISCORD_CLIENT_ID: client.application.id,
      DISCORD_GUILD_ID: guild.id,
      SUPPORT_ROLE_ID: role.id,
      DEOBFUSCATE_CHANNEL_ID: channel.id
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
