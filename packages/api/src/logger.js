/**
 * Redacting and Security-Compliant Logger for Product API.
 * 
 * Invariants:
 * - NEVER logs source code or recovered code.
 * - NEVER logs raw request body.
 * - NEVER logs credentials, tokens, or cookies.
 * - Captures metadata: requestId, jobId, principalId, contentSha256, byteCount, state, durationMs, error code.
 */

class RedactingLogger {
  /**
   * @param {object} [options]
   * @param {boolean} [options.captureLogs=false]
   */
  constructor(options = {}) {
    this.captureLogs = !!options.captureLogs;
    this.capturedEntries = [];
  }

  log(level, eventName, metadata = {}) {
    // Sanitize metadata to guarantee non-leakage
    const sanitized = {
      timestamp: new Date().toISOString(),
      level,
      event: eventName,
      requestId: metadata.requestId || null,
      jobId: metadata.jobId || null,
      principalId: metadata.principalId || null,
      contentSha256: metadata.contentSha256 || null,
      byteCount: typeof metadata.byteCount === 'number' ? metadata.byteCount : null,
      state: metadata.state || null,
      durationMs: typeof metadata.durationMs === 'number' ? metadata.durationMs : null,
      errorCode: metadata.errorCode || null,
      httpMethod: metadata.httpMethod || null,
      httpPath: metadata.httpPath || null,
      statusCode: metadata.statusCode || null
    };

    // Remove any null/undefined keys
    for (const key of Object.keys(sanitized)) {
      if (sanitized[key] === null) {
        delete sanitized[key];
      }
    }

    const logLine = JSON.stringify(sanitized);

    if (this.captureLogs) {
      this.capturedEntries.push(logLine);
    }

    if (process.env.NODE_ENV !== 'test' && !process.env.SILENT_LOGS) {
      if (level === 'ERROR') {
        console.error(logLine);
      } else {
        console.log(logLine);
      }
    }
  }

  info(event, meta) {
    this.log('INFO', event, meta);
  }

  warn(event, meta) {
    this.log('WARN', event, meta);
  }

  error(event, meta) {
    this.log('ERROR', event, meta);
  }

  getCapturedLogs() {
    return this.capturedEntries.join('\n');
  }

  clearCapturedLogs() {
    this.capturedEntries = [];
  }
}

module.exports = {
  RedactingLogger
};
