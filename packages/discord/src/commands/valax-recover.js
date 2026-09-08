/**
 * Slash command implementation for /valax-recover (and /recover).
 * Strictly routes file attachment to Product API via ProductApiClient.
 * Never imports or invokes recovery core, worker, or Docker directly.
 */

const ValaxRecoverCommand = {
  name: 'valax-recover',
  description: 'Deobfuscate and normalize heavily transformed Lua/Luau source code',
  options: [
    {
      name: 'file',
      description: 'The obfuscated Lua/Luau script file to analyze and recover',
      type: 11, // ATTACHMENT
      required: true
    },
    {
      name: 'stage',
      description: 'Target recovery level (default: L5)',
      type: 3, // STRING
      required: false,
      choices: [
        { name: 'L1 - Constants Normalized', value: 'L1' },
        { name: 'L2 - Strings Recovered', value: 'L2' },
        { name: 'L3 - Runtime Simplified', value: 'L3' },
        { name: 'L4 - Control Flow Recovered', value: 'L4' },
        { name: 'L5 - Source Reconstructed', value: 'L5' }
      ]
    }
  ],

  /**
   * Executes the /recover command.
   * @param {object} interaction - Discord interaction object
   * @param {object} context
   * @param {import('../api-client').ProductApiClient} context.apiClient
   * @param {import('../attachment-fetcher').AttachmentFetcher} context.attachmentFetcher
   */
  async execute(interaction, { apiClient, attachmentFetcher }) {
    await interaction.deferReply({ ephemeral: true });

    const attachment = interaction.options.getAttachment('file');
    const stage = interaction.options.getString('stage') || 'L5';
    const discordUserId = interaction.user?.id || interaction.member?.user?.id;

    if (!attachment) {
      return interaction.editReply({
        content: '❌ Error: No script file attached.',
        ephemeral: true
      });
    }

    try {
      // 1. Safely fetch attachment via SSRF-guarded stream
      const fetched = await attachmentFetcher.fetchAttachment(attachment.url);

      // 2. Submit to Product API as this Discord principal
      const submitRes = await apiClient.submitRecovery(discordUserId, {
        filename: attachment.name || fetched.filename,
        source: fetched.content,
        options: { stage }
      }, {
        username: interaction.user?.username,
        global_name: interaction.user?.global_name
      });

      const data = submitRes.json;

      // 3. Ephemeral response containing Job ID and tracking details
      return interaction.editReply({
        content: `🛡️ **Recovery Job Submitted Successfully**\n` +
          `**Job ID**: \`${data.jobId}\`\n` +
          `**Status**: \`${data.status}\`\n` +
          `**Queue Position**: ${data.queuePosition || 1}\n` +
          `Use \`/status ${data.jobId}\` to check progress.`,
        ephemeral: true
      });

    } catch (err) {
      return interaction.editReply({
        content: `❌ Submission failed: ${err.message}`,
        ephemeral: true
      });
    }
  }
};

module.exports = {
  ValaxRecoverCommand
};
