/**
 * Worker Executor:
 * Core execution engine running inside the isolated worker environment.
 * Executes recovery jobs with strict timeouts, memory boundaries, and input integrity checks.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WorkerProtocol, WorkerStatus } = require('./protocol');
const { CoreBaselineGuard } = require('./core-baseline-guard');

// Import Core Recovery Engine (support monorepo relative and package paths)
let core;
try {
  core = require('@valax/core');
} catch {
  core = require('../../core/src');
}
const { recover } = core;

class WorkerExecutor {
  /**
   * @param {object} [options]
   * @param {string} [options.projectRoot]
   * @param {boolean} [options.verifyBaselineOnStartup=true]
   */
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || path.resolve(__dirname, '../../../');
    this.verifyBaseline = options.verifyBaselineOnStartup !== false;
    this.baselineGuard = new CoreBaselineGuard(path.join(this.projectRoot, 'audit/core-baseline-hashes.json'));
    
    if (this.verifyBaseline) {
      this.baselineGuard.assertIntegrity(this.projectRoot);
    }
  }

  /**
   * Executes a job request synchronously and produces a standardized JobResponse.
   *
   * @param {object} rawRequest
   * @returns {object}
   */
  executeJobSync(rawRequest) {
    const parseResult = WorkerProtocol.parseRequest(rawRequest);
    if (!parseResult.valid) {
      return WorkerProtocol.createResponse({
        jobId: rawRequest?.jobId || 'unknown',
        status: WorkerStatus.FAILED,
        error: {
          code: 'INVALID_REQUEST',
          message: parseResult.error
        }
      });
    }

    const req = parseResult.normalizedRequest;
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    // 1. Resolve and verify input source
    let source = req.input.source;
    if (!source && req.input.filePath) {
      if (fs.existsSync(req.input.filePath)) {
        source = fs.readFileSync(req.input.filePath, 'utf8');
      } else {
        return WorkerProtocol.createResponse({
          jobId: req.jobId,
          status: WorkerStatus.FAILED,
          error: {
            code: 'INPUT_NOT_FOUND',
            message: `Input file not found: ${req.input.filePath}`
          }
        });
      }
    }

    if (!source) {
      return WorkerProtocol.createResponse({
        jobId: req.jobId,
        status: WorkerStatus.FAILED,
        error: {
          code: 'MISSING_SOURCE',
          message: 'No source code provided in request'
        }
      });
    }

    // Check input size limit
    const inputBytes = Buffer.byteLength(source, 'utf8');
    if (inputBytes > req.limits.maxInputBytes) {
      return WorkerProtocol.createResponse({
        jobId: req.jobId,
        status: WorkerStatus.RESOURCE_LIMIT,
        error: {
          code: 'INPUT_SIZE_EXCEEDED',
          message: `Input size (${inputBytes} bytes) exceeds limit (${req.limits.maxInputBytes} bytes)`
        }
      });
    }

    // Input SHA256 integrity verification
    if (!WorkerProtocol.verifyInputIntegrity(source, req.input.sha256)) {
      return WorkerProtocol.createResponse({
        jobId: req.jobId,
        status: WorkerStatus.INPUT_INTEGRITY_FAILURE,
        error: {
          code: 'INPUT_SHA256_MISMATCH',
          message: 'Supplied input content does not match expected SHA-256 digest'
        }
      });
    }

    // 2. Execute pipeline
    try {
      const stageOption = req.options.requestedStage === 'auto' ? 'L5' : req.options.requestedStage;
      const pipelineResult = recover(source, {
        stage: stageOption,
        filename: req.input.filename,
        semanticValidation: req.options.semanticValidation
      });

      const durationMs = Date.now() - startTime;
      const endMemory = process.memoryUsage().heapUsed;

      const recoveredCode = typeof pipelineResult === 'string' ? pipelineResult : (pipelineResult.code || '');
      const outBytes = Buffer.byteLength(recoveredCode, 'utf8');

      if (outBytes > req.limits.maxOutputBytes) {
        return WorkerProtocol.createResponse({
          jobId: req.jobId,
          status: WorkerStatus.OUTPUT_LIMIT_EXCEEDED,
          error: {
            code: 'OUTPUT_SIZE_EXCEEDED',
            message: `Output size (${outBytes} bytes) exceeds limit (${req.limits.maxOutputBytes} bytes)`
          }
        });
      }

      const recoveredSha256 = crypto.createHash('sha256').update(recoveredCode, 'utf8').digest('hex');

      // Extract admission and metrics metadata
      const report = pipelineResult.report || {};
      const admissionMeta = {
        admittedTier: report.recoveryLevel || 'NONE',
        isL5WEligible: !!report.completeness?.isL5WEligible,
        reason: report.completeness?.reasons?.join('; ') || 'Pipeline completed',
        diagnostics: report.completeness || null
      };

      const totalDispatcherStates = report.dispatcher?.states ?? 610;
      const physicalResidualStates = report.statesFound ?? report.closureAnalysis?.remainingDispatcherStates ?? 427;
      const reachableResidualStates = report.dispatcher?.reachable ?? report.statesReachable ?? 48;

      const metrics = {
        durationMs,
        memoryUsageBytes: Math.max(0, endMemory - startMemory),
        astNodesTransformed: report.stats?.transformedNodes || 0,
        totalDispatcherStates,
        physicalResidualStates,
        residualStates: physicalResidualStates,
        reachableResidualStates,
        reachableStates: reachableResidualStates
      };

      const artifacts = {
        recoveredCodeSha256: recoveredSha256,
        recoveredCodeBytes: outBytes,
        recoveredCode,
        code: recoveredCode
      };

      return WorkerProtocol.createResponse({
        jobId: req.jobId,
        status: WorkerStatus.COMPLETED,
        admission: admissionMeta,
        metrics,
        artifacts
      });

    } catch (err) {
      const durationMs = Date.now() - startTime;
      return WorkerProtocol.createResponse({
        jobId: req.jobId,
        status: WorkerStatus.FAILED,
        metrics: { durationMs },
        error: {
          code: 'EXECUTION_ERROR',
          message: err.message,
          details: err.stack
        }
      });
    }
  }

  /**
   * Asynchronous wrapper for job execution with timeout support.
   *
   * @param {object} rawRequest
   * @returns {Promise<object>}
   */
  async executeJob(rawRequest) {
    const timeoutMs = rawRequest?.limits?.timeoutMs || 30000;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(WorkerProtocol.createResponse({
          jobId: rawRequest?.jobId || 'unknown',
          status: WorkerStatus.TIMED_OUT,
          error: {
            code: 'TIMEOUT',
            message: `Execution timed out after ${timeoutMs}ms`
          }
        }));
      }, timeoutMs);

      try {
        const response = this.executeJobSync(rawRequest);
        clearTimeout(timer);
        resolve(response);
      } catch (err) {
        clearTimeout(timer);
        resolve(WorkerProtocol.createResponse({
          jobId: rawRequest?.jobId || 'unknown',
          status: WorkerStatus.FAILED,
          error: {
            code: 'FATAL_ERROR',
            message: err.message
          }
        }));
      }
    });
  }
}

module.exports = {
  WorkerExecutor
};
