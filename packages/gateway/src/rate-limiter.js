/**
 * Rate Limiter:
 * Enforces per-principal request rates, burst capacity, and concurrent job execution limits.
 */

class RateLimiter {
  /**
   * @param {object} [options]
   * @param {number} [options.windowMs=60000] Sliding window duration in ms (1 min)
   * @param {number} [options.maxRequestsPerWindow=60] Max requests per window
   * @param {number} [options.burstLimit=10] Max immediate burst requests
   * @param {number} [options.maxConcurrentPerPrincipal=2] Max concurrent running jobs per principal
   */
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60000;
    this.maxRequests = options.maxRequestsPerWindow || 60;
    this.burstLimit = options.burstLimit || 10;
    this.maxConcurrent = options.maxConcurrentPerPrincipal || 2;

    /** @type {Map<string, number[]>} principalId -> timestamps of requests */
    this.requestTimestamps = new Map();
    /** @type {Map<string, number>} principalId -> active job count */
    this.activeJobs = new Map();
  }

  /**
   * Evaluates if a request from principalId is allowed under the rate limit.
   * Supports specific action categorization (e.g. submit, status, artifact, request).
   *
   * @param {string} principalId
   * @param {string} [action='request']
   * @returns {{ allowed: boolean, remaining: number, resetMs: number, reason?: string }}
   */
  checkLimit(principalId, action = 'request') {
    const now = Date.now();
    const key = `${principalId}:${action}`;
    let timestamps = this.requestTimestamps.get(key) || [];

    // Filter out timestamps outside current sliding window
    timestamps = timestamps.filter(ts => now - ts < this.windowMs);
    this.requestTimestamps.set(key, timestamps);

    // Burst check: check requests in the last 1 second
    const recentBurst = timestamps.filter(ts => now - ts < 1000).length;
    if (recentBurst >= this.burstLimit) {
      return {
        allowed: false,
        remaining: 0,
        resetMs: 1000,
        reason: 'BURST_LIMIT_EXCEEDED'
      };
    }

    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0];
      const resetMs = Math.max(0, this.windowMs - (now - oldest));
      return {
        allowed: false,
        remaining: 0,
        resetMs,
        reason: 'WINDOW_RATE_LIMIT_EXCEEDED'
      };
    }

    timestamps.push(now);
    return {
      allowed: true,
      remaining: this.maxRequests - timestamps.length,
      resetMs: this.windowMs
    };
  }

  /**
   * Attempts to acquire a concurrency slot for a running job.
   *
   * @param {string} principalId
   * @returns {{ acquired: boolean, activeCount: number, maxAllowed: number }}
   */
  acquireConcurrency(principalId) {
    const current = this.activeJobs.get(principalId) || 0;
    if (current >= this.maxConcurrent) {
      return {
        acquired: false,
        activeCount: current,
        maxAllowed: this.maxConcurrent
      };
    }

    this.activeJobs.set(principalId, current + 1);
    return {
      acquired: true,
      activeCount: current + 1,
      maxAllowed: this.maxConcurrent
    };
  }

  /**
   * Releases a concurrency slot when a job completes or fails.
   *
   * @param {string} principalId
   */
  releaseConcurrency(principalId) {
    const current = this.activeJobs.get(principalId) || 0;
    if (current <= 1) {
      this.activeJobs.delete(principalId);
    } else {
      this.activeJobs.set(principalId, current - 1);
    }
  }

  /**
   * Cleans up all internal state.
   */
  reset() {
    this.requestTimestamps.clear();
    this.activeJobs.clear();
  }
}

/**
 * Production Redis-Backed Distributed Rate Limiter.
 * Uses atomic sliding window / counter operations in Redis.
 */
class RedisBackedRateLimiter extends RateLimiter {
  constructor(options = {}) {
    super(options);
    this.redisClient = options.redisClient || null;
    this.prefix = options.prefix || 'valax:ratelimit:';
  }

  checkLimitSync(principalId, action = 'request') {
    return super.checkLimit(principalId, action);
  }

  async checkLimitAsync(principalId, action = 'request') {
    if (!this.redisClient) {
      return super.checkLimit(principalId, action);
    }
    const key = `${this.prefix}${principalId}:${action}`;
    const now = Date.now();
    try {
      if (this.redisClient.sendCommand) {
        // Increment key and set expiration if first request
        const count = await this.redisClient.sendCommand(['INCR', key]);
        if (count === 1) {
          await this.redisClient.sendCommand(['PEXPIRE', key, String(this.windowMs)]);
        }
        if (count > this.maxRequests) {
          const ttl = await this.redisClient.sendCommand(['PTTL', key]);
          return {
            allowed: false,
            remaining: 0,
            resetMs: Math.max(1000, Number(ttl) || this.windowMs),
            reason: 'WINDOW_RATE_LIMIT_EXCEEDED'
          };
        }
        return {
          allowed: true,
          remaining: this.maxRequests - count,
          resetMs: this.windowMs
        };
      }
    } catch {
      // Fallback to local memory tracking if Redis command fails
      return super.checkLimit(principalId, action);
    }
    return super.checkLimit(principalId, action);
  }
}

module.exports = {
  RateLimiter,
  RedisBackedRateLimiter
};
