/**
 * In-Memory Job Queue with Leasing and Heartbeats:
 * Provides resilient job scheduling, backpressure control, stale lease recovery,
 * and idempotency deduplication.
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { JobState, TERMINAL_STATES, isValidTransition } = require('./types');

class InMemoryJobQueue extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.maxQueueDepth=100]
   * @param {number} [options.maxRunningJobs=10]
   * @param {number} [options.defaultLeaseDurationMs=30000]
   * @param {number} [options.maxRetries=2]
   */
  constructor(options = {}) {
    super();
    this.maxQueueDepth = options.maxQueueDepth || 100;
    this.maxRunningJobs = options.maxRunningJobs || 10;
    this.defaultLeaseDurationMs = options.defaultLeaseDurationMs || 30000;
    this.maxRetries = options.maxRetries ?? 2;

    /** @type {Map<string, object>} jobId -> job */
    this.jobs = new Map();
    /** @type {Map<string, string>} idempotencyKey -> jobId */
    this.idempotencyMap = new Map();
    /** @type {string[]} list of queued jobIds */
    this.waitingQueue = [];
    /** @type {Map<string, object>} active leases: jobId -> { token, workerId, expiresAt } */
    this.leases = new Map();

    this._cleanupTimer = null;
  }

  /**
   * Enqueues a new recovery job with idempotency checking.
   *
   * @param {object} jobData
   * @param {string} [jobData.jobId]
   * @param {string} [jobData.idempotencyKey]
   * @param {string} [jobData.principalId]
   * @param {object} jobData.payload
   * @returns {{ job: object, isDuplicate: boolean }}
   */
  enqueue(jobData) {
    // 1. Check idempotency
    const idempotencyKey = jobData.idempotencyKey || jobData.jobId;
    if (idempotencyKey && this.idempotencyMap.has(idempotencyKey)) {
      const existingJobId = this.idempotencyMap.get(idempotencyKey);
      const existingJob = this.jobs.get(existingJobId);
      if (existingJob) {
        return { job: existingJob, isDuplicate: true };
      }
    }

    // 2. Check backpressure
    if (this.waitingQueue.length >= this.maxQueueDepth) {
      const err = new Error(`Queue backpressure exceeded: max queue depth is ${this.maxQueueDepth}`);
      err.code = 'BACKPRESSURE_EXCEEDED';
      throw err;
    }

    // 3. Create job record
    const jobId = jobData.jobId || `job-${crypto.randomUUID()}`;
    const job = {
      jobId,
      idempotencyKey,
      principalId: jobData.principalId || 'anonymous',
      state: JobState.QUEUED,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0,
      maxRetries: this.maxRetries,
      payload: jobData.payload,
      result: null,
      error: null
    };

    this.jobs.set(jobId, job);
    if (idempotencyKey) {
      this.idempotencyMap.set(idempotencyKey, jobId);
    }
    this.waitingQueue.push(jobId);

    this.emit('enqueued', job);
    return { job, isDuplicate: false };
  }

  /**
   * Leases the next available queued job to a worker.
   *
   * @param {string} workerId
   * @param {number} [leaseDurationMs]
   * @returns {object|null} Leased job info with leaseToken, or null if no job available
   */
  leaseNextJob(workerId, leaseDurationMs) {
    this._reclaimStaleLeases();

    // Check concurrency limit
    const runningCount = this.getActiveLeaseCount();
    if (runningCount >= this.maxRunningJobs) {
      return null;
    }

    if (this.waitingQueue.length === 0) {
      return null;
    }

    const jobId = this.waitingQueue.shift();
    const job = this.jobs.get(jobId);
    if (!job || job.state !== JobState.QUEUED) {
      return null;
    }

    const duration = leaseDurationMs || this.defaultLeaseDurationMs;
    const leaseToken = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + duration;

    job.state = JobState.RUNNING;
    job.attempts++;
    job.updatedAt = new Date().toISOString();

    this.leases.set(jobId, {
      token: leaseToken,
      workerId,
      expiresAt,
      leaseDurationMs: duration
    });

    this.emit('leased', { jobId, workerId, leaseToken, expiresAt });
    return { job, leaseToken, expiresAt };
  }

  /**
   * Extends the lease duration for a running job.
   *
   * @param {string} jobId
   * @param {string} leaseToken
   * @param {number} [extensionMs]
   * @returns {boolean} true if lease was refreshed
   */
  heartbeat(jobId, leaseToken, extensionMs) {
    const lease = this.leases.get(jobId);
    if (!lease || lease.token !== leaseToken) {
      return false;
    }

    if (Date.now() > lease.expiresAt) {
      return false; // Already expired
    }

    const duration = extensionMs || lease.leaseDurationMs || this.defaultLeaseDurationMs;
    lease.expiresAt = Date.now() + duration;
    
    const job = this.jobs.get(jobId);
    if (job) {
      job.updatedAt = new Date().toISOString();
    }

    this.emit('heartbeat', { jobId, expiresAt: lease.expiresAt });
    return true;
  }

  /**
   * Completes a running job with result artifacts.
   *
   * @param {string} jobId
   * @param {string} leaseToken
   * @param {object} result
   * @returns {boolean}
   */
  completeJob(jobId, leaseToken, result) {
    const lease = this.leases.get(jobId);
    if (!lease || lease.token !== leaseToken) {
      return false;
    }

    const job = this.jobs.get(jobId);
    if (!job || !isValidTransition(job.state, JobState.COMPLETED)) {
      return false;
    }

    job.state = JobState.COMPLETED;
    job.result = result;
    job.updatedAt = new Date().toISOString();
    this.leases.delete(jobId);

    this.emit('completed', job);
    return true;
  }

  /**
   * Marks a job as failed.
   *
   * @param {string} jobId
   * @param {string} leaseToken
   * @param {object} error
   * @returns {boolean}
   */
  failJob(jobId, leaseToken, error) {
    const lease = this.leases.get(jobId);
    if (!lease || lease.token !== leaseToken) {
      return false;
    }

    const job = this.jobs.get(jobId);
    if (!job) return false;

    // Retry check
    if (job.attempts < job.maxRetries) {
      job.state = JobState.QUEUED;
      job.updatedAt = new Date().toISOString();
      this.leases.delete(jobId);
      this.waitingQueue.unshift(jobId); // Put back to front of queue
      this.emit('retried', job);
      return true;
    }

    job.state = JobState.FAILED;
    job.error = error;
    job.updatedAt = new Date().toISOString();
    this.leases.delete(jobId);

    this.emit('failed', job);
    return true;
  }

  /**
   * Cancels a job.
   *
   * @param {string} jobId
   * @param {string} reason
   * @returns {boolean}
   */
  cancelJob(jobId, reason = 'Cancelled by user') {
    const job = this.jobs.get(jobId);
    if (!job || TERMINAL_STATES.has(job.state)) {
      return false;
    }

    job.state = JobState.CANCELLED;
    job.error = { code: 'CANCELLED', message: reason };
    job.updatedAt = new Date().toISOString();

    this.leases.delete(jobId);
    this.waitingQueue = this.waitingQueue.filter(id => id !== jobId);

    this.emit('cancelled', job);
    return true;
  }

  /**
   * Reclaims jobs whose leases have expired without heartbeats.
   * @private
   */
  _reclaimStaleLeases() {
    const now = Date.now();
    for (const [jobId, lease] of this.leases.entries()) {
      if (now > lease.expiresAt) {
        this.leases.delete(jobId);
        const job = this.jobs.get(jobId);
        if (job && job.state === JobState.RUNNING) {
          if (job.attempts < job.maxRetries) {
            job.state = JobState.QUEUED;
            job.updatedAt = new Date().toISOString();
            this.waitingQueue.unshift(jobId);
            this.emit('lease_reclaimed', { jobId, reEnqueued: true });
          } else {
            job.state = JobState.TIMED_OUT;
            job.error = { code: 'LEASE_EXPIRED', message: 'Worker lease expired and retry limit reached' };
            job.updatedAt = new Date().toISOString();
            this.emit('lease_reclaimed', { jobId, reEnqueued: false });
          }
        }
      }
    }
  }

  /**
   * Retrieves a job by ID.
   *
   * @param {string} jobId
   * @returns {object|null}
   */
  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Returns current queue statistics.
   */
  getStats() {
    this._reclaimStaleLeases();
    let queued = 0, running = 0, completed = 0, failed = 0, cancelled = 0, timedOut = 0;

    for (const job of this.jobs.values()) {
      switch (job.state) {
        case JobState.QUEUED: queued++; break;
        case JobState.RUNNING: running++; break;
        case JobState.COMPLETED: completed++; break;
        case JobState.FAILED: failed++; break;
        case JobState.CANCELLED: cancelled++; break;
        case JobState.TIMED_OUT: timedOut++; break;
      }
    }

    return {
      totalJobs: this.jobs.size,
      queued,
      running,
      completed,
      failed,
      cancelled,
      timedOut
    };
  }

  getActiveLeaseCount() {
    return this.leases.size;
  }
}

module.exports = {
  InMemoryJobQueue
};
