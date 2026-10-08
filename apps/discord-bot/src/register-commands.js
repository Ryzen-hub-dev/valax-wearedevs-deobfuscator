require('./env');

const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('./config');

const recoveryCommand = new SlashCommandBuilder()
  .setName('1')
  .setDescription('Deobfuscate a WeAreDevs Lua/Luau script')
  .setDMPermission(false)
  .addStringOption(option => option
    .setName('link')
    .setDescription('Direct HTTPS link to a Lua/Luau script')
    .setMaxLength(2000))
  .addAttachmentOption(option => option
    .setName('file')
    .setDescription('Upload a .lua, .luau, or .txt script'))
  .addStringOption(option => option
    .setName('paste')
    .setDescription('Paste source code directly (up to 6000 characters)')
    .setMaxLength(6000));

const communityCommands = [
  new SlashCommandBuilder()
    .setName('about')
    .setDescription('Show live Valax server information and quick actions')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('View a Valax economy balance')
    .setDMPermission(false)
    .addUserOption(option => option.setName('user').setDescription('Member to view')),
  new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily Valax coin reward')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the richest Valax community members')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Open a private support ticket')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Submit a private Valax staff application')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('loa')
    .setDescription('Staff: request a leave of absence')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('drop')
    .setDescription('Staff: publish a first-claim reward drop')
    .setDMPermission(false)
    .addStringOption(option => option
      .setName('prize')
      .setDescription('Reward name or details')
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(200)),
  new SlashCommandBuilder()
    .setName('community-status')
    .setDescription('Staff: open the Valax control-center status view')
    .setDMPermission(false)
];

const commands = [recoveryCommand, ...communityCommands];

async function registerCommands(config = loadConfig()) {
  const rest = new REST({ version: '10' }).setToken(config.token);
  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: commands.map(command => command.toJSON()) }
  );
  console.log(`Registered ${commands.length} Valax commands in guild ${config.guildId}.`);
}

if (require.main === module) {
  registerCommands().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { command: recoveryCommand, commands, communityCommands, registerCommands };
