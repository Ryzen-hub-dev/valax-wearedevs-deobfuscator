const { recover } = require('../packages/core/src');
const crypto = require('crypto');

const DEFAULT_MAX_SOURCE_BYTES = 2_000_000;
const DEFAULT_MAX_OUTPUT_BYTES = 3_500_000;
const RECOVERY_STAGES = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(req) {
  const expected = process.env.INTERNAL_BOT_SERVICE_SECRET;
  if (!expected) return false;

  const authorization = req.headers?.authorization || '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  return secureEqual(supplied, expected);
}

function setSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function isCallStackError(error) {
  return error instanceof RangeError || /maximum call stack size exceeded/i.test(error?.message || '');
}

function recoverWithStackFallback(source, options, recoveryFn = recover) {
  const requestedIndex = RECOVERY_STAGES.indexOf(options.stage);
  const attempts = RECOVERY_STAGES.slice(0, requestedIndex + 1).reverse();
  let lastError;

  for (const stage of attempts) {
    try {
      const result = recoveryFn(source, { ...options, stage });
      if (stage !== options.stage) {
        result.report = result.report || {};
        result.report.warnings = Array.isArray(result.report.warnings) ? result.report.warnings : [];
        result.report.warnings.push(
          `Recovery was safely downgraded from ${options.stage} to ${stage} because the script exceeded the higher stage's structural depth limit.`
        );
        result.report.requestedStage = options.stage;
        result.report.executedStage = stage;
      }
      return result;
    } catch (error) {
      if (!isCallStackError(error)) throw error;
      lastError = error;
    }
  }

  throw lastError;
}

/**
 * REST endpoint for source code deobfuscation.
 * Accepts POST with JSON: { source: string, stage?: string, format?: string }
 */
module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  try {
    const { source, stage = 'L5', format = 'lua', filename = 'script.lua' } = req.body || {};

    if (!source || typeof source !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid "source" parameter.' });
    }

    const sourceBytes = Buffer.byteLength(source, 'utf8');
    const maxSourceBytes = readPositiveInt(process.env.MAX_SOURCE_BYTES, DEFAULT_MAX_SOURCE_BYTES);
    if (sourceBytes > maxSourceBytes) {
      return res.status(413).json({
        success: false,
        error: `Source exceeds the ${maxSourceBytes}-byte limit.`,
        code: 'SOURCE_TOO_LARGE'
      });
    }

    if (!/^L[0-5]$/.test(stage)) {
      return res.status(400).json({ success: false, error: 'Invalid recovery stage.', code: 'INVALID_STAGE' });
    }

    const result = recoverWithStackFallback(source, { stage, format, filename });
    const outputBytes = Buffer.byteLength(result.code || '', 'utf8');
    const maxOutputBytes = readPositiveInt(process.env.MAX_OUTPUT_BYTES, DEFAULT_MAX_OUTPUT_BYTES);
    if (outputBytes > maxOutputBytes) {
      return res.status(413).json({
        success: false,
        error: `Recovered output exceeds the ${maxOutputBytes}-byte response limit.`,
        code: 'OUTPUT_TOO_LARGE'
      });
    }

    return res.status(200).json({
      success: true,
      code: result.code,
      report: result.report
    });
  } catch (err) {
    console.error('Recovery request failed', {
      name: err?.name,
      message: err?.message,
      stack: err?.stack
    });
    return res.status(500).json({
      success: false,
      error: isCallStackError(err)
        ? 'The script is nested too deeply for safe recovery. Please upload the failing file so this structure can be supported.'
        : err.message,
      code: isCallStackError(err) ? 'STRUCTURE_TOO_DEEP' : (err.code || 'RECOVERY_ERROR')
    });
  }
};

module.exports._test = {
  isAuthorized,
  isCallStackError,
  recoverWithStackFallback,
  readPositiveInt,
  secureEqual
};
