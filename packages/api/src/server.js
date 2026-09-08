/**
 * Product-Facing HTTP API Server.
 * Communicates strictly with RecoveryGateway abstraction.
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const path = require('path');
const { DevelopmentAuthProvider } = require('./auth');
const { ApiError, ApiErrorCode, HTTP_STATUS_MAP } = require('./errors');
const { RedactingLogger } = require('./logger');
const {
  ProductJobState,
  TERMINAL_PRODUCT_STATES,
  CANCELLABLE_PRODUCT_STATES,
  mapInternalToProductState
} = require('./state-machine');

const DEFAULT_MAX_SOURCE_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_MAX_CONCURRENT_JOBS = 5;
const DEFAULT_MAX_JOBS_PER_DAY = 100;
const ALLOWED_EXTENSIONS = new Set(['.lua', '.luau', '.txt']);

class ProductApiServer {
  /**
   * @param {object} options
   * @param {object} options.gateway - RecoveryGateway instance
   * @param {object} [options.authProvider] - Custom or DevelopmentAuthProvider
   * @param {number} [options.maxSourceBytes]
   * @param {number} [options.maxConcurrentJobs]
   * @param {number} [options.maxJobsPerDay]
   * @param {RedactingLogger} [options.logger]
   */
  constructor(options = {}) {
    if (!options.gateway) {
      throw new Error('RecoveryGateway instance is required for ProductApiServer');
    }
    this.gateway = options.gateway;
    this.maxSourceBytes = options.maxSourceBytes || DEFAULT_MAX_SOURCE_BYTES;
    this.maxConcurrentJobs = options.maxConcurrentJobs || DEFAULT_MAX_CONCURRENT_JOBS;
    this.maxJobsPerDay = options.maxJobsPerDay || DEFAULT_MAX_JOBS_PER_DAY;
    this.logger = options.logger || new RedactingLogger();

    const nodeEnv = process.env.NODE_ENV || 'development';
    if (options.authProvider) {
      this.authProvider = options.authProvider;
    } else {
      if (nodeEnv !== 'production') {
        this.authProvider = new DevelopmentAuthProvider({ nodeEnv });
      } else {
        this.authProvider = null; // Production OAuth required in later round
      }
    }

    // Server-side idempotency registry: map of (principalId:idempotencyKey) -> { jobId, contentSha256 }
    this.idempotencyRegistry = new Map();

    // Daily quota tracker: map of (principalId:YYYY-MM-DD) -> count
    this.dailyJobCounts = new Map();

    this.server = http.createServer(this._handleRequest.bind(this));
  }

  /**
   * Starts listening synchronously via callback.
   */
  listen(port, callback) {
    return this.server.listen(port, callback);
  }

  /**
   * Starts listening asynchronously and resolves to the bound port.
   */
  start(port = this.port) {
    return new Promise((resolve, reject) => {
      this.server.listen(port, (err) => {
        if (err) return reject(err);
        const addr = this.server.address();
        this.port = typeof addr === 'object' && addr ? addr.port : port;
        resolve(this.port);
      });
    });
  }

  /**
   * Closes server safely.
   */
  close(callback) {
    if (!this.server.listening) {
      if (callback) callback();
      return Promise.resolve();
    }
    return this.server.close(callback);
  }

  /**
   * Internal request dispatcher with security headers and error boundaries.
   * @private
   */
  async _handleRequest(req, res) {
    const startTime = Date.now();
    const requestId = `req-${crypto.randomBytes(8).toString('hex')}`;
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
    const method = req.method.toUpperCase();

    // 1. Mandatory Security Headers
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self';");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Request-Id', requestId);

    try {
      // 2. Public Health Endpoints (No Auth Required)
      if (pathname === '/health/live' && method === 'GET') {
        return this._handleHealthLive(res, requestId);
      }
      if (pathname === '/health/ready' && method === 'GET') {
        return this._handleHealthReady(res, requestId);
      }

      // 3. Resolve Authenticated Principal
      const principal = this._resolvePrincipal(req);

      // 3.5 API Request Rate Limiter (per-principal)
      if (this.gateway?.rateLimiter) {
        let action = 'request';
        if (pathname === '/api/v1/recoveries' && method === 'POST') action = 'submit';
        else if (pathname.includes('/artifacts/')) action = 'download';
        else if (pathname.includes('/artifacts')) action = 'list';
        else if (pathname.startsWith('/api/v1/recoveries/') && method === 'GET') action = 'status';

        const rateCheck = this.gateway.rateLimiter.checkLimit(principal.principalId, action);
        if (!rateCheck.allowed) {
          const retryAfterSec = Math.max(1, Math.ceil((rateCheck.resetMs || 1000) / 1000));
          res.setHeader('Retry-After', String(retryAfterSec));
          throw new ApiError(ApiErrorCode.RATE_LIMITED, `Rate limit exceeded: ${rateCheck.reason}`, 429);
        }
      }

      // 4. Route Dispatch
      if (pathname === '/api/v1/recoveries') {
        if (method === 'POST') {
          return await this._handleSubmitRecovery(req, res, principal, requestId, startTime);
        }
        throw new ApiError(ApiErrorCode.INTERNAL_ERROR, 'Method Not Allowed', 405);
      }

      // Routes matching /api/v1/recoveries/:jobId
      const jobMatch = pathname.match(/^\/api\/v1\/recoveries\/([a-zA-Z0-9_-]+)$/);
      if (jobMatch) {
        const jobId = jobMatch[1];
        if (method === 'GET') {
          return await this._handleGetRecovery(res, principal, jobId, requestId);
        }
        if (method === 'DELETE') {
          return await this._handleCancelRecovery(res, principal, jobId, requestId);
        }
        throw new ApiError(ApiErrorCode.INTERNAL_ERROR, 'Method Not Allowed', 405);
      }

      // Routes matching /api/v1/recoveries/:jobId/artifacts
      const artifactsMatch = pathname.match(/^\/api\/v1\/recoveries\/([a-zA-Z0-9_-]+)\/artifacts$/);
      if (artifactsMatch) {
        const jobId = artifactsMatch[1];
        if (method === 'GET') {
          return await this._handleListArtifacts(res, principal, jobId, requestId);
        }
        throw new ApiError(ApiErrorCode.INTERNAL_ERROR, 'Method Not Allowed', 405);
      }

      // Routes matching /api/v1/recoveries/:jobId/artifacts/:artifactId
      const artifactDownloadMatch = pathname.match(/^\/api\/v1\/recoveries\/([a-zA-Z0-9_-]+)\/artifacts\/([a-zA-Z0-9_.-]+)$/);
      if (artifactDownloadMatch) {
        const jobId = artifactDownloadMatch[1];
        const artifactId = artifactDownloadMatch[2];
        if (method === 'GET') {
          return await this._handleDownloadArtifact(res, principal, jobId, artifactId, requestId);
        }
        throw new ApiError(ApiErrorCode.INTERNAL_ERROR, 'Method Not Allowed', 405);
      }

      // Route Not Found
      throw new ApiError(ApiErrorCode.JOB_NOT_FOUND, 'Route not found', 404);

    } catch (err) {
      this._sendErrorResponse(res, err, requestId);
    }
  }

  /**
   * Resolves principal from request headers via configured auth provider.
   * @private
   */
  _resolvePrincipal(req) {
    if (!this.authProvider) {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Authentication is not configured', 401);
    }

    try {
      const principal = this.authProvider.authenticate(req);
      if (!principal) {
        throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Authentication required: missing or invalid credentials', 401);
      }
      return principal;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, err.message, 401);
    }
  }

  /**
   * Health Check: Liveness
   * @private
   */
  _handleHealthLive(res, requestId) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'OK',
      requestId,
      timestamp: new Date().toISOString()
    }));
  }

  /**
   * Health Check: Readiness
   * @private
   */
  _handleHealthReady(res, requestId) {
    const ready = this.gateway.getReadiness ? this.gateway.getReadiness() : { ready: true };
    const statusCode = ready.ready ? 200 : 503;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ready: ready.ready,
      coreBaseline: ready.coreBaseline || null,
      queue: ready.queue || null,
      requestId,
      timestamp: new Date().toISOString()
    }));
  }

  /**
   * Handler: POST /api/v1/recoveries
   * Bounded body read, filename validation, idempotency, rate limits, quotas.
   * @private
   */
  async _handleSubmitRecovery(req, res, principal, requestId, startTime) {
    // 1. Quota Check: Daily Limit
    const todayKey = `${principal.principalId}:${new Date().toISOString().slice(0, 10)}`;
    const currentDailyCount = this.dailyJobCounts.get(todayKey) || 0;
    if (currentDailyCount >= this.maxJobsPerDay) {
      throw new ApiError(ApiErrorCode.QUOTA_EXCEEDED, `Daily quota exceeded (${this.maxJobsPerDay} jobs/day)`, 429);
    }

    // 2. Read Bounded Request Body
    const bodyBuf = await this._readBoundedBody(req, this.maxSourceBytes);
    let bodyStr;
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      bodyStr = decoder.decode(bodyBuf);
    } catch {
      throw new ApiError(ApiErrorCode.INVALID_ENCODING, 'Malformed UTF-8 encoding in request payload', 400);
    }

    let payload;
    try {
      payload = JSON.parse(bodyStr);
    } catch {
      throw new ApiError(ApiErrorCode.INVALID_FILE, 'Malformed JSON payload', 400);
    }

    const { filename, source, options = {} } = payload;

    // 3. Filename Normalization & Path Traversal Rejection
    const sanitizedFilename = this._sanitizeFilename(filename);

    // 4. Source Content Validation
    if (!source || typeof source !== 'string') {
      throw new ApiError(ApiErrorCode.INVALID_FILE, 'Source content must be a non-empty string', 400);
    }
    if (source.includes('\0')) {
      throw new ApiError(ApiErrorCode.INVALID_FILE, 'Source content cannot contain NUL bytes', 400);
    }

    const sourceBytes = Buffer.byteLength(source, 'utf8');
    if (sourceBytes > this.maxSourceBytes) {
      throw new ApiError(ApiErrorCode.FILE_TOO_LARGE, `Source size (${sourceBytes} bytes) exceeds limit (${this.maxSourceBytes} bytes)`, 413);
    }

    const contentSha256 = crypto.createHash('sha256').update(source, 'utf8').digest('hex');

    // 5. Idempotency Check
    const idempotencyKey = req.headers['idempotency-key'] || payload.idempotencyKey || null;
    if (idempotencyKey) {
      const regKey = `${principal.principalId}:${idempotencyKey}`;
      const existing = this.idempotencyRegistry.get(regKey);
      if (existing) {
        if (existing.contentSha256 !== contentSha256) {
          throw new ApiError(
            ApiErrorCode.IDEMPOTENCY_CONFLICT,
            `Idempotency key '${idempotencyKey}' was previously used with different source content`,
            409
          );
        }
        // Return existing job representation without re-enqueueing
        const existingJob = await this.gateway.getJob(existing.jobId, principal.principalId);
        return this._sendJsonResponse(res, 200, {
          jobId: existingJob.jobId,
          state: mapInternalToProductState(existingJob.state),
          createdAt: existingJob.createdAt,
          isDuplicate: true,
          links: {
            self: `/api/v1/recoveries/${existingJob.jobId}`
          }
        });
      }
    }

    // 6. Submit Job through Gateway
    let submitResult;
    try {
      submitResult = await (this.gateway.submitJob ? this.gateway.submitJob({
        principalId: principal.principalId,
        source,
        filename: sanitizedFilename,
        idempotencyKey,
        options: {
          requestedStage: options.requestedStage || 'auto',
          semanticValidation: options.semanticValidation !== false,
          skipRateCheck: true
        },
        limits: {
          timeoutMs: options.timeoutMs || 30000,
          maxInputBytes: this.maxSourceBytes
        }
      }) : this.gateway.submitJobSync({
        principalId: principal.principalId,
        source,
        filename: sanitizedFilename,
        idempotencyKey,
        options: {
          requestedStage: options.requestedStage || 'auto',
          semanticValidation: options.semanticValidation !== false,
          skipRateCheck: true
        },
        limits: {
          timeoutMs: options.timeoutMs || 30000,
          maxInputBytes: this.maxSourceBytes
        }
      }));
    } catch (err) {
      if (err.code === 'RATE_LIMIT_EXCEEDED') {
        res.setHeader('Retry-After', Math.ceil((err.resetMs || 1000) / 1000));
        throw new ApiError(ApiErrorCode.RATE_LIMITED, err.message, 429);
      }
      if (err.code === 'PRINCIPAL_CONCURRENCY_EXCEEDED') {
        throw new ApiError(ApiErrorCode.QUOTA_EXCEEDED, err.message, 429);
      }
      if (err.code === 'QUEUE_FULL' || err.code === 'SATURATED' || err.code === 'BACKPRESSURE_EXCEEDED' || err.code === 'QUEUE_SATURATED') {
        res.setHeader('Retry-After', '5');
        throw new ApiError(ApiErrorCode.QUEUE_SATURATED, 'Recovery queue is temporarily saturated. Please retry later.', 503);
      }
      throw new ApiError(ApiErrorCode.INTERNAL_ERROR, err.message, 500);
    }

    const jobId = submitResult?.jobId || submitResult?.job?.jobId;
    if (!jobId) {
      throw new ApiError(ApiErrorCode.INTERNAL_ERROR, 'Failed to obtain job identifier from queue submission', 500);
    }

    // 7. Register Idempotency and update daily quota
    if (idempotencyKey) {
      this.idempotencyRegistry.set(`${principal.principalId}:${idempotencyKey}`, {
        jobId,
        contentSha256
      });
    }
    this.dailyJobCounts.set(todayKey, currentDailyCount + 1);

    // 8. Safe Log Event (Zero Source Logging!)
    this.logger.info('RECOVERY_SUBMITTED', {
      requestId,
      jobId,
      principalId: principal.principalId,
      contentSha256,
      byteCount: sourceBytes,
      state: 'QUEUED',
      durationMs: Date.now() - startTime
    });

    // 9. Return Canonical Product POST Response
    const responsePayload = {
      jobId,
      state: ProductJobState.QUEUED,
      createdAt: submitResult.createdAt || new Date().toISOString(),
      links: {
        self: `/api/v1/recoveries/${jobId}`,
        artifacts: `/api/v1/recoveries/${jobId}/artifacts`
      }
    };

    return this._sendJsonResponse(res, 201, responsePayload);
  }

  /**
   * Handler: GET /api/v1/recoveries/:jobId
   * @private
   */
  async _handleGetRecovery(res, principal, jobId, requestId) {
    let job;
    try {
      job = await this.gateway.getJob(jobId, principal.principalId);
    } catch (err) {
      if (err.code === 'FORBIDDEN') {
        throw new ApiError(ApiErrorCode.FORBIDDEN, `Access denied: You do not own job ${jobId}`, 403);
      }
      throw new ApiError(ApiErrorCode.JOB_NOT_FOUND, `Job not found: ${jobId}`, 404);
    }

    const productState = mapInternalToProductState(job.state);
    const isComplete = TERMINAL_PRODUCT_STATES.has(productState);

    const response = {
      jobId: job.jobId,
      state: productState,
      createdAt: job.createdAt,
      startedAt: job.startedAt || job.createdAt,
      completedAt: isComplete ? (job.updatedAt || new Date().toISOString()) : null,
      progress: {
        stage: isComplete ? 'complete' : 'recovering'
      },
      recovery: job.result ? {
        level: job.result.admission?.admittedTier || 'NONE',
        semanticStatus: 'CONSERVATIVE',
        warnings: job.result.admission?.diagnostics?.reasons || [],
        metrics: {
          totalDispatcherStates: job.result.metrics?.totalDispatcherStates ?? 0,
          dispatcherStatesBefore: job.result.metrics?.totalDispatcherStates ?? 0,
          physicalResidualStates: job.result.metrics?.physicalResidualStates ?? job.result.metrics?.residualStates ?? 0,
          reachableResidualStates: job.result.metrics?.reachableResidualStates ?? job.result.metrics?.reachableStates ?? 0,
          residualStates: job.result.metrics?.physicalResidualStates ?? job.result.metrics?.residualStates ?? 0,
          reachableStates: job.result.metrics?.reachableResidualStates ?? job.result.metrics?.reachableStates ?? 0,
          dispatcherStatesAfter: job.result.metrics?.astNodesTransformed ?? 0,
          durationMs: job.result.metrics?.durationMs ?? 0
        }
      } : null,
      error: job.error ? {
        code: job.error.code || ApiErrorCode.RECOVERY_FAILED,
        message: job.error.message || 'Recovery failed'
      } : null,
      links: {
        self: `/api/v1/recoveries/${job.jobId}`,
        artifacts: `/api/v1/recoveries/${job.jobId}/artifacts`
      }
    };

    return this._sendJsonResponse(res, 200, response);
  }

  /**
   * Handler: DELETE /api/v1/recoveries/:jobId
   * Cancellation request.
   * @private
   */
  async _handleCancelRecovery(res, principal, jobId, requestId) {
    let job;
    try {
      job = await this.gateway.getJob(jobId, principal.principalId);
    } catch (err) {
      if (err.code === 'FORBIDDEN') {
        throw new ApiError(ApiErrorCode.FORBIDDEN, `Access denied: You do not own job ${jobId}`, 403);
      }
      throw new ApiError(ApiErrorCode.JOB_NOT_FOUND, `Job not found: ${jobId}`, 404);
    }

    const currentState = mapInternalToProductState(job.state);
    if (!CANCELLABLE_PRODUCT_STATES.has(currentState)) {
      throw new ApiError(
        ApiErrorCode.JOB_NOT_CANCELLABLE,
        `Cannot cancel job '${jobId}' in terminal state '${currentState}'`,
        409
      );
    }

    try {
      await this.gateway.cancelJob(jobId, principal.principalId, 'User requested cancellation');
    } catch (err) {
      if (err.code === 'FORBIDDEN') {
        throw new ApiError(ApiErrorCode.FORBIDDEN, err.message, 403);
      }
      throw new ApiError(ApiErrorCode.INTERNAL_ERROR, err.message, 500);
    }

    this.logger.info('RECOVERY_CANCELLED', {
      requestId,
      jobId,
      principalId: principal.principalId,
      state: ProductJobState.CANCELLED
    });

    return this._sendJsonResponse(res, 200, {
      jobId,
      state: ProductJobState.CANCELLED,
      message: 'Recovery job cancellation confirmed'
    });
  }

  /**
   * Handler: GET /api/v1/recoveries/:jobId/artifacts
   * @private
   */
  async _handleListArtifacts(res, principal, jobId, requestId) {
    let job;
    try {
      job = await this.gateway.getJob(jobId, principal.principalId);
    } catch (err) {
      if (err.code === 'FORBIDDEN') {
        throw new ApiError(ApiErrorCode.FORBIDDEN, `Access denied for job ${jobId}`, 403);
      }
      throw new ApiError(ApiErrorCode.JOB_NOT_FOUND, `Job not found: ${jobId}`, 404);
    }

    const productState = mapInternalToProductState(job.state);
    if (productState !== ProductJobState.SUCCEEDED) {
      return this._sendJsonResponse(res, 200, {
        jobId,
        artifacts: []
      });
    }

    const artifacts = [
      {
        artifactId: 'recoveredCode',
        type: 'text/x-lua',
        description: 'Normalized and recovered Lua source code',
        href: `/api/v1/recoveries/${jobId}/artifacts/recoveredCode`
      },
      {
        artifactId: 'report',
        type: 'application/json',
        description: 'Deobfuscation analysis and admission report',
        href: `/api/v1/recoveries/${jobId}/artifacts/report`
      }
    ];

    return this._sendJsonResponse(res, 200, {
      jobId,
      artifacts
    });
  }

  /**
   * Handler: GET /api/v1/recoveries/:jobId/artifacts/:artifactId
   * @private
   */
  async _handleDownloadArtifact(res, principal, jobId, artifactId, requestId) {
    if (!['recoveredCode', 'report', 'logs'].includes(artifactId)) {
      throw new ApiError(ApiErrorCode.ARTIFACT_NOT_FOUND, `Artifact '${artifactId}' does not exist`, 404);
    }

    let artifactContent;
    try {
      artifactContent = await this.gateway.getArtifact(jobId, artifactId, principal.principalId);
    } catch (err) {
      if (err.code === 'FORBIDDEN') {
        throw new ApiError(ApiErrorCode.FORBIDDEN, `Access denied for artifact in job ${jobId}`, 403);
      }
      if (err.code === 'NOT_FOUND' || err.code === 'ARTIFACT_EXPIRED' || err.code === 'EXPIRED') {
        const isExpired = (err.message && err.message.toLowerCase().includes('expired')) || err.code === 'ARTIFACT_EXPIRED' || err.code === 'EXPIRED';
        const code = isExpired ? ApiErrorCode.ARTIFACT_EXPIRED : ApiErrorCode.ARTIFACT_NOT_FOUND;
        const status = isExpired ? 410 : 404;
        throw new ApiError(code, `Artifact not found or expired for job ${jobId}`, status);
      }
      throw new ApiError(ApiErrorCode.INTERNAL_ERROR, err.message, 500);
    }

    if (!artifactContent) {
      throw new ApiError(ApiErrorCode.ARTIFACT_NOT_FOUND, `Artifact '${artifactId}' is empty or unavailable`, 404);
    }

    const contentType = artifactId === 'recoveredCode' ? 'text/x-lua; charset=utf-8' : 'application/json; charset=utf-8';
    const payload = typeof artifactContent === 'string' ? artifactContent : JSON.stringify(artifactContent, null, 2);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': Buffer.byteLength(payload, 'utf8')
    });
    res.end(payload);
  }

  /**
   * Validates and sanitizes filename. Rejects path traversal and dangerous characters.
   * @private
   */
  _sanitizeFilename(rawFilename) {
    if (!rawFilename || typeof rawFilename !== 'string') {
      return 'input.lua';
    }

    if (rawFilename.length > 255) {
      throw new ApiError(ApiErrorCode.INVALID_FILE, 'Filename exceeds maximum length of 255 characters', 400);
    }

    if (rawFilename.includes('\0')) {
      throw new ApiError(ApiErrorCode.INVALID_FILE, 'Filename cannot contain NUL bytes', 400);
    }

    // Explicit rejection of path traversal sequences
    if (
      rawFilename.includes('..') ||
      rawFilename.includes('/') ||
      rawFilename.includes('\\') ||
      rawFilename.startsWith('file:') ||
      rawFilename.match(/^[a-zA-Z]:/)
    ) {
      throw new ApiError(
        ApiErrorCode.INVALID_FILE,
        'Filename contains illegal path traversal characters or paths',
        400
      );
    }

    const ext = path.extname(rawFilename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new ApiError(
        ApiErrorCode.INVALID_FILE,
        `Unsupported file extension '${ext}'. Allowed: .lua, .luau, .txt`,
        400
      );
    }

    // Strip everything except safe alphanumeric, dash, underscore, and dot
    const base = path.basename(rawFilename);
    const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!sanitized || sanitized.length > 255) {
      throw new ApiError(ApiErrorCode.INVALID_FILE, 'Filename invalid or exceeds maximum length', 400);
    }

    return sanitized;
  }

  /**
   * Bounded body reader ensuring uploads cannot exceed limit or consume unbounded memory.
   * @private
   */
  _readBoundedBody(req, limitBytes) {
    return new Promise((resolve, reject) => {
      let received = 0;
      const chunks = [];
      let aborted = false;

      req.on('data', chunk => {
        if (aborted) return;
        received += chunk.length;
        if (received > limitBytes) {
          aborted = true;
          req.pause();
          req.resume(); // Drain stream without buffering to allow 413 response delivery
          reject(new ApiError(
            ApiErrorCode.FILE_TOO_LARGE,
            `Request body exceeds maximum size of ${limitBytes} bytes`,
            413
          ));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (aborted) return;
        resolve(Buffer.concat(chunks));
      });

      req.on('error', err => {
        if (aborted) return;
        reject(new ApiError(ApiErrorCode.INTERNAL_ERROR, `Stream error: ${err.message}`, 500));
      });
    });
  }

  /**
   * Standard JSON response helper.
   * @private
   */
  _sendJsonResponse(res, status, payload) {
    const jsonStr = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(jsonStr, 'utf8')
    });
    res.end(jsonStr);
  }

  /**
   * Standard Error response helper.
   * @private
   */
  _sendErrorResponse(res, err, requestId) {
    const apiError = err instanceof ApiError ? err : new ApiError(ApiErrorCode.INTERNAL_ERROR, err.message, 500);
    const statusCode = apiError.status || HTTP_STATUS_MAP[apiError.code] || 500;

    this.logger.error('API_ERROR_RESPONSE', {
      requestId,
      errorCode: apiError.code,
      statusCode
    });

    const errorPayload = apiError.toResponse(requestId);
    const jsonStr = JSON.stringify(errorPayload);

    if (!res.headersSent) {
      res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(jsonStr, 'utf8'),
        'Connection': 'close'
      });
    }
    res.end(jsonStr);
  }
}

module.exports = {
  ProductApiServer
};
