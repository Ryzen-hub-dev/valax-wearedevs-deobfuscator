/**
 * Slash command implementation for /status.
 * Queries job status through Product API client as the invoking Discord user.
 */

const StatusCommand = {
  name: 'status',
  description: 'Check the recovery progress or results of a submitted job',
  options: [
    {
      name: 'job_id',
      description: 'The job ID returned when submitting recovery',
      type: 3, // STRING
      required: true
    }
  ],

  /**
   * Executes the /status command.
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
      const res = await apiClient.getRecovery(discordUserId, jobId, {
        username: interaction.user?.username
      });
      const data = res.json;

      const embed = {
        title: `🛡️ Recovery Job: ${data.jobId}`,
        color: data.status === 'COMPLETED' ? 0x57F287 : (data.status === 'FAILED' ? 0xED4245 : 0x5865F2),
        fields: [
          { name: 'Status', value: `\`${data.status}\``, inline: true },
          { name: 'File', value: `\`${data.filename}\``, inline: true },
          { name: 'Created', value: new Date(data.createdAt).toLocaleTimeString(), inline: true }
        ],
        footer: { text: 'Valax Product API' },
        timestamp: new Date().toISOString()
      };

      if (data.durationMs) {
        embed.fields.push({ name: 'Duration', value: `${data.durationMs}ms`, inline: true });
      }

      if (data.result) {
        embed.fields.push({ name: 'Format', value: data.result.detectedFormat || 'Unknown', inline: true });
        embed.fields.push({ name: 'Stage', value: data.result.recoveryLevel || 'L5', inline: true });
        if (data.result.metrics) {
          const m = data.result.metrics;
          embed.fields.push({
            name: 'Residual Dispatcher States',
            value: `${m.reachableResidualStates} reachable / ${m.physicalResidualStates} physical / ${m.totalDispatcherStates} total`,
            inline: false
          });
        }
      }

      if (data.error) {
        embed.fields.push({ name: 'Error', value: `\`${data.error.message}\``, inline: false });
      }

      return interaction.editReply({
        content: `Status for job \`${jobId}\`:`,
        embeds: [embed],
        ephemeral: true
      });

    } catch (err) {
      if (err.statusCode === 403) {
        return interaction.editReply({
          content: '⛔ **Access Denied**: You do not have permission to view this recovery job.',
          ephemeral: true
        });
      }
      if (err.statusCode === 404) {
        return interaction.editReply({
          content: `❌ **Not Found**: Job \`${jobId}\` was not found.`,
          ephemeral: true
        });
      }
      return interaction.editReply({
        content: `❌ Error checking status: ${err.message}`,
        ephemeral: true
      });
    }
  }
};

module.exports = {
  StatusCommand
};
