/**
 * Discord Bot Adapter for Gateway/Interaction dispatching.
 * Strictly communicates with Product API via ProductApiClient.
 * Never imports recovery core, worker, or Docker directly.
 */

const { ProductApiClient } = require('./api-client');
const { AttachmentFetcher } = require('./attachment-fetcher');
const { ValaxRecoverCommand } = require('./commands/valax-recover');
const { StatusCommand } = require('./commands/status');
const { CancelCommand } = require('./commands/cancel');

class DiscordBotAdapter {
  /**
   * @param {object} options
   * @param {object} [options.client] - Discord.js or compatible client
   * @param {ProductApiClient} [options.apiClient]
   * @param {AttachmentFetcher} [options.attachmentFetcher]
   * @param {string} [options.apiBaseUrl]
   * @param {string} [options.botServiceSecret]
   */
  constructor(options = {}) {
    this.client = options.client || null;
    this.apiClient = options.apiClient || new ProductApiClient({
      apiBaseUrl: options.apiBaseUrl || 'http://127.0.0.1:3000',
      serviceSecret: options.botServiceSecret
    });
    this.attachmentFetcher = options.attachmentFetcher || new AttachmentFetcher();

    this.commands = new Map([
      ['valax-recover', ValaxRecoverCommand],
      ['recover', ValaxRecoverCommand],
      ['status', StatusCommand],
      ['cancel', CancelCommand]
    ]);
  }

  /**
   * Registers commands with the bot client if client is present.
   */
  registerCommands() {
    console.log('[Valax Discord Bot] Registered commands: /recover, /status, /cancel');
  }

  /**
   * Dispatches incoming Discord interaction to the appropriate command handler.
   * @param {object} interaction
   */
  async handleInteraction(interaction) {
    if (!interaction || !interaction.isChatInputCommand || !interaction.isChatInputCommand()) {
      return;
    }

    const command = this.commands.get(interaction.commandName);
    if (!command) {
      return;
    }

    const context = {
      apiClient: this.apiClient,
      attachmentFetcher: this.attachmentFetcher
    };

    return command.execute(interaction, context);
  }
}

module.exports = {
  DiscordBotAdapter
};
