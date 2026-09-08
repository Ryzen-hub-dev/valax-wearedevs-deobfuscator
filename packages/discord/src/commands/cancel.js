/**
 * Slash command implementation for /cancel.
 * Cancels active recovery job through Product API client as invoking Discord user.
 */

const CancelCommand = {
  name: 'cancel',
  description: 'Cancel an ongoing or queued recovery job',
  options: [
    {
      name: 'job_id',
      description: 'The job ID to cancel',
      type: 3, // STRING
      required: true
    }
  ],

  /**
   * Executes the /cancel command.
   * @param {object} interaction
   * @param {object} context
   * @param {import('../api-client').ProductApiClient} context.apiClient
   */
  async execute(interaction, { apiClient }) {
    await interaction.deferReply({ ephemeral: true });

    const jobId = interaction.options.getString('job_id');
    const discordUserId = interaction.user?.id || interaction.member?.user?.id;

    if (!jobId) {
      return interaction.editReply({
        content: '❌ Error: job_id is required.',
        ephemeral: true
      });
    }

    try {
      const res = await apiClient.cancelRecovery(discordUserId, jobId, {
        username: interaction.user?.username
      });
      const data = res.json;

      return interaction.editReply({
        content: `🛑 Job \`${jobId}\` cancelled successfully. (Status: \`${data.status}\`)`,
        ephemeral: true
      });

    } catch (err) {
      if (err.statusCode === 403) {
        return interaction.editReply({
          content: '⛔ **Access Denied**: You do not have permission to cancel this recovery job.',
          ephemeral: true
        });
      }
      if (err.statusCode === 404) {
        return interaction.editReply({
          content: `❌ **Not Found**: Job \`${jobId}\` was not found.`,
          ephemeral: true
        });
      }
      if (err.statusCode === 409) {
        return interaction.editReply({
          content: `⚠️ Job \`${jobId}\` cannot be cancelled because it is already finished or processing.`,
          ephemeral: true
        });
      }
      return interaction.editReply({
        content: `❌ Cancellation failed: ${err.message}`,
        ephemeral: true
      });
    }
  }
};

module.exports = {
  CancelCommand
};
