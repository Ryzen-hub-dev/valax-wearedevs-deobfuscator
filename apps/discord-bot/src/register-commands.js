const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('./config');

const command = new SlashCommandBuilder()
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

async function registerCommands(config = loadConfig()) {
  const rest = new REST({ version: '10' }).setToken(config.token);
  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: [command.toJSON()] }
  );
  console.log(`Registered /1 in guild ${config.guildId}.`);
}

if (require.main === module) {
  registerCommands().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { command, registerCommands };
