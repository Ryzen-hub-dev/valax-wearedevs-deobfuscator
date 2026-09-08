/**
 * Worker Protocol (Schema Version 1):
 * Standardized, versioned JSON IPC contract between outer gateway/orchestrator
 * and isolated container recovery worker.
 */

const crypto = require('crypto');

const PROTOCOL_VERSION = '1';

const WorkerStatus = {
  COMPLETED: 'completed',
  FAILED: 'failed',
  TIMED_OUT: 'timed_out',
  RESOURCE_LIMIT: 'resource_limit',
  INPUT_INTEGRITY_FAILURE: 'input_integrity_failure',
  OUTPUT_LIMIT_EXCEEDED: 'output_limit_exceeded'
};

class WorkerProtocol {
  /**
   * Validates and normalizes an incoming JobRequest.
   *
   * @param {object} req
   * @returns {{ valid: boolean, error?: string, normalizedRequest?: object }}
   */
  static parseRequest(req) {
    if (!req || typeof req !== 'object') {
      return { valid: false, error: 'Request must be a JSON object' };
    }

    if (req.schemaVersion !== PROTOCOL_VERSION) {
      return { valid: false, error: `Unsupported schemaVersion: expected '${PROTOCOL_VERSION}', got '${req.schemaVersion}'` };
    }

    if (!req.jobId || typeof req.jobId !== 'string') {
      return { valid: false, error: 'jobId is required and must be a string' };
    }

    if (!req.input || typeof req.input !== 'object') {
      return { valid: false, error: 'input object is required' };
    }

    if (!req.input.sha256 || typeof req.input.sha256 !== 'string' || req.input.sha256.length !== 64) {
      return { valid: false, error: 'input.sha256 must be a 64-character hex string' };
    }

    const normalized = {
      schemaVersion: PROTOCOL_VERSION,
      jobId: req.jobId,
      idempotencyKey: req.idempotencyKey || req.jobId,
      input: {
        filename: req.input.filename || 'input.lua',
        sha256: req.input.sha256.toLowerCase(),
        bytes: typeof req.input.bytes === 'number' ? req.input.bytes : null,
        source: req.input.source || null
      },
      options: {
        requestedStage: req.options?.requestedStage || 'auto',
        semanticValidation: req.options?.semanticValidation !== false
      },
      limits: {
        timeoutMs: req.limits?.timeoutMs || 30000,
        maxInputBytes: req.limits?.maxInputBytes || 5 * 1024 * 1024,
        maxOutputBytes: req.limits?.maxOutputBytes || 2 * 1024 * 1024
      }
    };

    return { valid: true, normalizedRequest: normalized };
  }

  /**
   * Validates input source against expected SHA-256 hash.
   *
   * @param {string|Buffer} source
   * @param {string} expectedSha256
   * @returns {boolean}
   */
  static verifyInputIntegrity(source, expectedSha256) {
    if (!source || !expectedSha256) return false;
    const computed = crypto.createHash('sha256').update(source, 'utf8').digest('hex').toLowerCase();
    return computed === expectedSha256.toLowerCase();
  }

  /**
   * Constructs a standardized JobResponse.
   *
   * @param {object} params
   * @returns {object}
   */
  static createResponse({
    jobId,
    status,
    admission = null,
    metrics = null,
    artifacts = null,
    error = null,
    workerMeta = null
  }) {
    return {
      schemaVersion: PROTOCOL_VERSION,
      jobId,
      status,
      timestamp: new Date().toISOString(),
      admission: admission ? {
        admittedTier: admission.admittedTier || 'NONE',
        isL5WEligible: !!admission.isL5WEligible,
        reason: admission.reason || null,
        diagnostics: admission.diagnostics || null
      } : null,
      metrics: metrics ? {
        durationMs: metrics.durationMs || 0,
        memoryUsageBytes: metrics.memoryUsageBytes || 0,
        astNodesTransformed: metrics.astNodesTransformed || 0,
        totalDispatcherStates: metrics.totalDispatcherStates ?? 0,
        physicalResidualStates: metrics.physicalResidualStates ?? metrics.residualStates ?? 0,
        residualStates: metrics.physicalResidualStates ?? metrics.residualStates ?? 0,
        reachableResidualStates: metrics.reachableResidualStates ?? metrics.reachableStates ?? 0,
        reachableStates: metrics.reachableResidualStates ?? metrics.reachableStates ?? 0
      } : null,
      artifacts: artifacts ? {
        recoveredCode: artifacts.recoveredCode || null,
        recoveredCodeSha256: artifacts.recoveredCodeSha256 || null,
        recoveredCodeBytes: artifacts.recoveredCodeBytes || 0,
        reportSha256: artifacts.reportSha256 || null
      } : null,
      error: error ? {
        code: error.code || 'UNKNOWN_ERROR',
        message: error.message || String(error),
        details: error.details || null
      } : null,
      workerMeta: workerMeta || {
        hostname: process.env.HOSTNAME || 'local-worker',
        pid: process.pid,
        nodeVersion: process.version
      }
    };
  }
}

module.exports = {
  PROTOCOL_VERSION,
  WorkerStatus,
  WorkerProtocol
};
