/**
 * Format structured Discord embed and status text for deobfuscation results.
 * @param {object} report
 */
function formatRecoveryResponse(report) {
  const inKb = (report.inputBytes / 1024).toFixed(1);
  const outKb = (report.outputBytes / 1024).toFixed(1);
  const confPct = Math.round(report.confidence * 100);

  const embed = {
    title: '🛡️ Valax Source Recovery',
    color: 0x5865F2,
    fields: [
      { name: 'Detected Format', value: `${report.detectedFormat} ${report.version}`, inline: true },
      { name: 'Recovery Level', value: `**${report.recoveryLevel}**`, inline: true },
      { name: 'Confidence', value: `${confPct}%`, inline: true },
      { name: 'Input Size', value: `${inKb} KB`, inline: true },
      { name: 'Output Size', value: `${outKb} KB`, inline: true },
      { name: 'Time Elapsed', value: `${report.elapsedMs} ms`, inline: true },
      { name: 'Strings Decoded', value: `${report.stringsRecovered} / ${report.stringsFound}`, inline: true },
      { name: 'Constants Folded', value: `${report.constantsFolded}`, inline: true },
      { name: 'Aliases Recovered', value: `${report.aliasesRecovered}`, inline: true }
    ],
    footer: { text: 'Valax Source Recovery Engine' },
    timestamp: new Date().toISOString()
  };

  if (report.dispatcher) {
    embed.fields.push(
      { name: 'State Variable', value: `\`${report.dispatcher.dispatcherCandidate}\``, inline: true },
      { name: 'CFG States', value: `${report.dispatcher.reachable} reachable / ${report.dispatcher.states} total`, inline: true }
    );
  }

  const content = `**Valax Source Recovery**\n` +
    `Format: ${report.detectedFormat} ${report.version}\n` +
    `Recovery Level: ${report.recoveryLevel}\n` +
    `Input: ${inKb} KB\n` +
    `Output: ${outKb} KB\n` +
    `Confidence: ${confPct}%`;

  return { content, embed };
}

module.exports = { formatRecoveryResponse };
