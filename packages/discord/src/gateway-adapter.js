/**
 * Optional traditional Gateway adapter for persistent process hosting.
 * Allows persistent bot processes to use the exact same core engine.
 */
class GatewayBotAdapter {
  constructor(client, options = {}) {
    this.client = client;
    this.options = options;
  }

  registerCommands() {
    // Registers /valax-recover on persistent Discord client
    console.log('[Valax Gateway] Command /valax-recover registered');
  }

  async handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'valax-recover') return;

    await interaction.deferReply();
    const attachment = interaction.options.getAttachment('file');
    const stage = interaction.options.getString('stage') || 'L5';

    if (!attachment) {
      await interaction.editReply({ content: 'Error: No file attached.' });
      return;
    }

    try {
      const resp = await fetch(attachment.url);
      const source = await resp.text();
      const { recover } = require('../../core/src');
      const result = recover(source, { filename: attachment.name, stage });
      const { formatRecoveryResponse } = require('./responses/messages');
      const formatted = formatRecoveryResponse(result.report);

      await interaction.editReply({
        content: formatted.content,
        embeds: [formatted.embed],
        files: [
          { attachment: Buffer.from(result.code, 'utf8'), name: `${attachment.name}.recovered.lua` },
          { attachment: Buffer.from(JSON.stringify(result.report, null, 2), 'utf8'), name: `${attachment.name}.report.json` }
        ]
      });
    } catch (err) {
      await interaction.editReply({ content: `Recovery failed: ${err.message}` });
    }
  }
}

module.exports = { GatewayBotAdapter };
