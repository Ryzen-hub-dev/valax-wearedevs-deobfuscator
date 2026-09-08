/**
 * Recovery Gateway:
 * Unified hosted gateway coordinating rate limiting, authorization, job queue scheduling,
 * container worker dispatch, artifact storage, and health checks.
 */

const crypto = require('crypto');
const { RateLimiter } = require('./rate-limiter');
const { EphemeralArtifactStore } = require('./artifact-store');
const { MetricsCollector } = require('./metrics');

let queuePkg, workerPkg;
try {
  queuePkg = require('@valax/queue');
} catch {
  queuePkg = require('../../queue/src');
}

try {
  workerPkg = require('@valax/worker');
} catch {
  workerPkg = require('../../worker/src');
}

const { InMemoryJobQueue, JobState } = queuePkg;
const { ContainerRunner, CoreBaselineGuard, PROTOCOL_VERSION } = workerPkg;

class RecoveryGateway {
  /**
   * @param {object} [options]
   * @param {RateLimiter} [options.rateLimiter]
   * @param {InMemoryJobQueue} [options.queue]
   * @param {EphemeralArtifactStore} [options.artifactStore]
   * @param {MetricsCollector} [options.metrics]
   * @param {ContainerRunner} [options.containerRunner]
   */
  constructor(options = {}) {
    this.rateLimiter = options.rateLimiter || new RateLimiter();
    this.queue = options.queue || new InMemoryJobQueue();
    this.artifactStore = options.artifactStore || new EphemeralArtifactStore();
    this.metrics = options.metrics || new MetricsCollector();
    this.containerRunner = options.containerRunner || new ContainerRunner();
    this.baselineGuard = new CoreBaselineGuard();
  }

  /**
   * Submits a recovery job from an authenticated principal (Synchronous core).
   *
   * @param {object} params
   * @returns {object}
   */
  submitJobSync({
    principalId,
    source,
    filename = 'input.lua',
    idempotencyKey = null,
    options = {},
    limits = {}
  }) {
    if (!principalId) {
      throw new Error('principalId is required');
    }

    if (!source || typeof source !== 'string') {
      throw new Error('source must be a non-empty string');
    }

    // 1. Rate limiting (if not already checked at API boundary)
    if (!options.skipRateCheck) {
      const rateCheck = this.rateLimiter.checkLimit(principalId, 'submit');
      if (!rateCheck.allowed) {
        this.metrics.inc('rate_limit_rejections_total');
        const err = new Error(`Rate limit exceeded: ${rateCheck.reason}`);
        err.code = 'RATE_LIMIT_EXCEEDED';
        err.resetMs = rateCheck.resetMs;
        throw err;
      }
    }

    // 2. Hash source
    const sha256 = crypto.createHash('sha256').update(source, 'utf8').digest('hex');
    const inputBytes = Buffer.byteLength(source, 'utf8');

    // 3. Prepare payload for worker protocol
    const jobId = `job-${crypto.randomBytes(8).toString('hex')}`;
    const payload = {
      schemaVersion: PROTOCOL_VERSION,
      jobId,
      idempotencyKey: idempotencyKey || jobId,
      input: {
        filename,
        sha256,
        bytes: inputBytes,
        source
      },
      options: {
        requestedStage: options.requestedStage || 'auto',
        semanticValidation: options.semanticValidation !== false
      },
      limits: {
        timeoutMs: limits.timeoutMs || 30000,
        maxInputBytes: limits.maxInputBytes || 5 * 1024 * 1024,
        maxOutputBytes: limits.maxOutputBytes || 2 * 1024 * 1024
      }
    };

    // 4. Enqueue in job queue
    const enqResult = this.queue.enqueue({
      jobId,
      idempotencyKey,
      principalId,
      payload
    });

    if (enqResult && typeof enqResult.then === 'function') {
      return enqResult.then(({ job, isDuplicate }) => {
        if (!isDuplicate) {
          this.metrics.inc('jobs_submitted_total');
          this.artifactStore.initJobArtifacts(job.jobId, principalId, { sourceCode: source });
        }
        return {
          jobId: job.jobId,
          state: job.state,
          idempotencyKey: job.idempotencyKey,
          isDuplicate,
          createdAt: job.createdAt
        };
      });
    }

    const { job, isDuplicate } = enqResult;

    if (!isDuplicate) {
      this.metrics.inc('jobs_submitted_total');
      this.artifactStore.initJobArtifacts(job.jobId, principalId, { sourceCode: source });
    }

    return {
      jobId: job.jobId,
      state: job.state,
      idempotencyKey: job.idempotencyKey,
      isDuplicate,
      createdAt: job.createdAt
    };
  }

  async submitJob(params) {
    return this.submitJobSync(params);
  }

  /**
   * Leases and processes the next queued job synchronously.
   *
   * @param {string} [workerId='worker-1']
   * @returns {object|null}
   */
  processNextJobSync(workerId = 'worker-1') {
    const lease = this.queue.leaseNextJob(workerId);
    if (!lease) return null;

    const { job, leaseToken } = lease;
    const principalId = job.principalId;

    // Concurrency tracking per principal
    const conc = this.rateLimiter.acquireConcurrency(principalId);
    if (!conc.acquired) {
      this.queue.failJob(job.jobId, leaseToken, {
        code: 'PRINCIPAL_CONCURRENCY_EXCEEDED',
        message: `Principal '${principalId}' has reached max concurrent jobs (${conc.maxAllowed})`
      });
      return null;
    }

    try {
      // Execute through container runner synchronously
      const workerResponse = this.containerRunner.runJobSync(job.payload);

      // Save artifacts
      if (workerResponse.artifacts?.recoveredCode) {
        this.artifactStore.saveRecoveredCode(job.jobId, workerResponse.artifacts.recoveredCode);
      }
      if (workerResponse.admission) {
        this.artifactStore.saveReport(job.jobId, {
          admission: workerResponse.admission,
          metrics: workerResponse.metrics
        });
      }

      // Purge original input source for user privacy
      this.artifactStore.purgeSourceCode(job.jobId);

      // Record metrics
      if (workerResponse.status === 'completed') {
        this.metrics.inc('jobs_completed_total');
        if (workerResponse.metrics?.durationMs) {
          this.metrics.recordJobDuration(workerResponse.metrics.durationMs);
        }
        if (workerResponse.admission) {
          this.metrics.recordAdmission(
            workerResponse.admission.admittedTier,
            workerResponse.admission.isL5WEligible
          );
        }
        this.queue.completeJob(job.jobId, leaseToken, workerResponse);
      } else if (workerResponse.status === 'timed_out') {
        this.metrics.inc('jobs_timed_out_total');
        this.queue.failJob(job.jobId, leaseToken, workerResponse.error);
      } else {
        this.metrics.inc('jobs_failed_total');
        this.queue.failJob(job.jobId, leaseToken, workerResponse.error);
      }

      return workerResponse;
    } catch (err) {
      this.metrics.inc('jobs_failed_total');
      this.artifactStore.purgeSourceCode(job.jobId);
      this.queue.failJob(job.jobId, leaseToken, {
        code: 'DISPATCH_ERROR',
        message: err.message
      });
      throw err;
    } finally {
      this.rateLimiter.releaseConcurrency(principalId);
    }
  }

  /**
   * Asynchronous process job.
   */
  async processNextJob(workerId = 'worker-1') {
    return this.processNextJobSync(workerId);
  }

  /**
   * Retrieves status of a job.
   *
   * @param {string} jobId
   * @param {string} principalId
   * @returns {object}
   */
  _formatJob(job, jobId, principalId) {
    if (!job) {
      const err = new Error(`Job not found: ${jobId}`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (job.principalId !== principalId) {
      const err = new Error(`Forbidden: Principal '${principalId}' does not own job '${jobId}'`);
      err.code = 'FORBIDDEN';
      throw err;
    }

    return {
      jobId: job.jobId,
      state: job.state,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      attempts: job.attempts,
      result: job.result ? {
        status: job.result.status,
        admission: job.result.admission,
        metrics: job.result.metrics,
        artifacts: {
          recoveredCodeSha256: job.result.artifacts?.recoveredCodeSha256,
          recoveredCodeBytes: job.result.artifacts?.recoveredCodeBytes
        }
      } : null,
      error: job.error
    };
  }

  getJob(jobId, principalId) {
    const res = this.queue.getJob(jobId);
    if (res && typeof res.then === 'function') {
      return res.then(job => this._formatJob(job, jobId, principalId));
    }
    return this._formatJob(res, jobId, principalId);
  }

  /**
   * Retrieves an artifact.
   *
   * @param {string} jobId
   * @param {'recoveredCode'|'report'|'logs'} artifactType
   * @param {string} principalId
   */
  getArtifact(jobId, artifactType, principalId) {
    return this.artifactStore.getArtifact(jobId, artifactType, principalId);
  }

  /**
   * Cancels a job.
   *
   * @param {string} jobId
   * @param {string} principalId
   */
  cancelJob(jobId, principalId, reason) {
    const handleJob = (job) => {
      if (!job) {
        const err = new Error(`Job not found: ${jobId}`);
        err.code = 'NOT_FOUND';
        throw err;
      }

      if (job.principalId !== principalId) {
        const err = new Error(`Forbidden: Principal '${principalId}' does not own job '${jobId}'`);
        err.code = 'FORBIDDEN';
        throw err;
      }

      const cancelledRes = this.queue.cancelJob(jobId, reason);
      if (cancelledRes && typeof cancelledRes.then === 'function') {
        return cancelledRes.then(cancelled => {
          if (cancelled) {
            this.metrics.inc('jobs_cancelled_total');
            this.artifactStore.purgeSourceCode(jobId);
          }
          return cancelled;
        });
      }
      if (cancelledRes) {
        this.metrics.inc('jobs_cancelled_total');
        this.artifactStore.purgeSourceCode(jobId);
      }
      return cancelledRes;
    };

    const res = this.queue.getJob(jobId);
    if (res && typeof res.then === 'function') {
      return res.then(handleJob);
    }
    return handleJob(res);
  }

  /**
   * Health endpoints: Liveness and Readiness.
   */
  getLiveness() {
    return {
      status: 'OK',
      timestamp: new Date().toISOString()
    };
  }

  getReadiness() {
    try {
      const baselineResult = this.baselineGuard.verify();
      const stats = this.queue.getStats();
      return {
        ready: baselineResult.verified,
        coreBaseline: {
          verified: baselineResult.verified,
          baselineTag: baselineResult.baselineTag,
          totalChecked: baselineResult.totalChecked
        },
        queue: stats,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        ready: false,
        error: err.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = {
  RecoveryGateway
};
