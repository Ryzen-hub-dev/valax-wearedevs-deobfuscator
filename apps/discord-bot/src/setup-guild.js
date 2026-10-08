const {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits
} = require('discord.js');

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !guildId) {
  throw new Error('DISCORD_BOT_TOKEN and DISCORD_GUILD_ID are required.');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(guildId);
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

    let channel = guild.channels.cache.find(item =>
      item.type === ChannelType.GuildText && item.name === 'deobfuscate'
    );

    const permissionOverwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
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
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ManageChannels
        ]
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
      await channel.edit({
        topic: 'Set your custom status to “support valaxscrub.shop”, then use /1.',
        rateLimitPerUser: 1200,
        permissionOverwrites,
        reason: 'Valax deobfuscation channel setup'
      });
    }

    console.log('Discord setup complete. Add these values to the bot environment:');
    console.log(`SUPPORT_ROLE_ID=${role.id}`);
    console.log(`DEOBFUSCATE_CHANNEL_ID=${channel.id}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

client.login(token);
