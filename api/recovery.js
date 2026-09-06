const { recover } = require('../packages/core/src');

/**
 * REST endpoint for source code deobfuscation.
 * Accepts POST with JSON: { source: string, stage?: string, format?: string }
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { source, stage = 'L5', format = 'lua', filename = 'script.lua' } = req.body || {};

    if (!source || typeof source !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "source" parameter.' });
    }

    const result = recover(source, { stage, format, filename });
    return res.status(200).json({
      success: true,
      code: result.code,
      report: result.report
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
      code: err.code || 'RECOVERY_ERROR'
    });
  }
};
