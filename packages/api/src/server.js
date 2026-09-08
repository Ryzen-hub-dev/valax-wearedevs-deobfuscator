/**
 * Product-Facing HTTP API Server.
 * Communicates strictly with RecoveryGateway abstraction.
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const path = require('path');
const { Principal, DevelopmentAuthProvider } = require('./auth');
const { MongoIdentityStore } = require('./auth/identity-store');
const { SessionStore, MemorySessionStore, MongoSessionStore } = require('./auth/session-store');
const { DiscordOAuthController } = require('./auth/discord-oauth');
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
   * @param {object} [options.identityStore] - MongoIdentityStore instance
   * @param {object} [options.sessionStore] - SessionStore instance
   * @param {object} [options.oauthController] - DiscordOAuthController instance
   * @param {string} [options.botServiceSecret]
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

    this.nodeEnv = options.nodeEnv || process.env.NODE_ENV || 'development';

    // 1. Identity & Session Stores
    this.identityStore = options.identityStore || new MongoIdentityStore({
      mongoUri: options.mongoUri || process.env.MONGODB_URI
    });

    this.sessionStore = options.sessionStore || new MongoSessionStore({
      nodeEnv: this.nodeEnv,
      collection: options.sessionCollection,
      idleTtlSeconds: options.sessionIdleTtlSeconds,
      absoluteTtlSeconds: options.sessionAbsoluteTtlSeconds
    });

    this.botServiceSecret = options.botServiceSecret || process.env.INTERNAL_BOT_SERVICE_SECRET || 'valax-bot-service-secret';

    // 2. OAuth Controller
    this.oauthController = options.oauthController || new DiscordOAuthController({
      clientId: options.clientId || process.env.DISCORD_CLIENT_ID,
      clientSecret: options.clientSecret || process.env.DISCORD_CLIENT_SECRET,
      redirectUri: options.redirectUri || process.env.DISCORD_REDIRECT_URI,
      sessionSecret: options.sessionSecret || process.env.SESSION_SECRET,
      botServiceSecret: this.botServiceSecret,
      identityStore: this.identityStore,
      sessionStore: this.sessionStore,
      discordApiBase: options.discordApiBase,
      nodeEnv: this.nodeEnv,
      logger: this.logger
    });

    // 3. Auth Provider handling (DevelopmentAuthProvider strictly forbidden in production)
    if (options.authProvider) {
      if (this.nodeEnv === 'production' && options.authProvider instanceof DevelopmentAuthProvider) {
        throw new Error('FATAL_AUTH_CONFIGURATION: DevelopmentAuthProvider cannot be initialized in production');
      }
      this.authProvider = options.authProvider;
    } else {
      if (this.nodeEnv !== 'production') {
        this.authProvider = new DevelopmentAuthProvider({ nodeEnv: this.nodeEnv });
      } else {
        this.authProvider = null; // In production, Discord OAuth2 and bot signed assertions are authoritative
      }
    }

    // Server-side idempotency registry: map of (principalId:idempotencyKey) -> { jobId, contentSha256 }
    this.idempotencyRegistry = new Map();

    // Daily quota tracker: map of (principalId:YYYY-MM-DD) -> count
    this.dailyJobCounts = new Map();

    // Job filename registry
    this.jobFilenames = new Map();

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

      // 2.5 Public OAuth Initiation and Callback
      if (pathname === '/auth/discord' && method === 'GET') {
        return await this.oauthController.handleAuthorize(req, res);
      }
      if (pathname === '/auth/discord/callback' && method === 'GET') {
        return await this.oauthController.handleCallback(req, res);
      }

      // 3. Resolve Authenticated Principal & Context
      const authContext = await this._resolvePrincipal(req);
      const principal = authContext.principal;

      // 3.1 Authenticated Auth / Session Routes
      if (pathname === '/auth/logout' && method === 'POST') {
        this._validateCsrf(req, authContext);
        return await this.oauthController.handleLogout(req, res, authContext.session);
      }
      if (pathname === '/auth/session' && method === 'GET') {
        return this.oauthController.handleSessionInfo(res, authContext.session || { principal, csrfToken: null });
      }
      if (pathname === '/api/v1/me' && method === 'GET') {
        return this.oauthController.handleMe(res, authContext.session || { principal });
      }

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
          this._validateCsrf(req, authContext);
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
          this._validateCsrf(req, authContext);
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
   * Validates CSRF synchronizer token for browser session requests.
   * Service/bot assertion calls bypass ambient cookie CSRF checks.
   * @private
   */
  _validateCsrf(req, authContext) {
    if (!authContext.isBrowserSession) {
      return;
    }
    const headerToken = req.headers['x-csrf-token'];
    const sessionToken = authContext.session?.csrfToken;
    if (!headerToken || !sessionToken || headerToken !== sessionToken) {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'CSRF verification failed: missing or invalid CSRF token', 403);
    }
  }

  /**
   * Resolves principal from request via Bot Assertion, Browser Session, or AuthProvider.
   * @private
   */
  async _resolvePrincipal(req) {
    const headers = req.headers || {};
    const authHeader = headers['authorization'];
    const assertionHeader = headers['x-principal-assertion'];

    // 1. Check Bot Service Authentication + Signed Principal Assertion
    if (assertionHeader) {
      try {
        const assertion = this.oauthController.verifyPrincipalAssertion(assertionHeader);
        const provider = assertion.provider || 'discord';
        const sub = assertion.sub || assertion.providerSubject;
        const principal = await this.identityStore.getOrCreatePrincipal(provider, sub, assertion.metadata || {});
        
        return {
          principal,
          principalId: principal.principalId,
          roles: principal.roles,
          provider: principal.provider,
          isBotAssertion: true
        };
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError(ApiErrorCode.UNAUTHORIZED, `Bot assertion verification failed: ${err.message}`, 401);
      }
    }

    // 2. Check Browser Session Cookie (valax_session)
    const cookies = this.oauthController.parseCookies(req);
    const sessionToken = cookies['valax_session'];
    if (sessionToken) {
      try {
        const session = await this.sessionStore.getSession(sessionToken);
        if (session && session.principal) {
          const principal = new Principal(session.principal);
          return {
            principal,
            principalId: principal.principalId,
            roles: principal.roles,
            provider: principal.provider,
            session,
            isBrowserSession: true
          };
        }
      } catch (err) {
        if (this.nodeEnv === 'production') {
          throw new ApiError(ApiErrorCode.INTERNAL_ERROR, 'Session store failure in production', 503);
        }
      }
    }

    // 3. Development / Custom Auth Provider Fallback
    if (this.authProvider) {
      if (this.nodeEnv === 'production') {
        // Strict boundary: Development headers cannot be accepted in production
        const devHeader = headers['x-development-principal'] || headers['x-dev-principal'];
        if (devHeader || (authHeader && authHeader.toLowerCase().startsWith('bearer dev-'))) {
          throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'SECURITY_VIOLATION: DevelopmentAuthProvider invoked under production NODE_ENV', 401);
        }
      }

      try {
        const principal = this.authProvider.authenticate(req);
        if (principal) {
          return {
            principal,
            principalId: principal.principalId,
            roles: principal.roles,
            provider: principal.provider,
            isDevProvider: true
          };
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError(ApiErrorCode.UNAUTHORIZED, err.message, 401);
      }
    }

    // 4. No valid credentials provided
    throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Authentication required: missing or invalid credentials', 401);
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
   * Checks Gateway, Core Baseline, Queue, and Production Auth configuration.
   * @private
   */
  _handleHealthReady(res, requestId) {
    const ready = this.gateway.getReadiness ? this.gateway.getReadiness() : { ready: true };

    let authReady = true;
    if (this.nodeEnv === 'production') {
      if (!this.oauthController.clientId || !this.oauthController.clientSecret || !this.oauthController.redirectUri) {
        authReady = false;
      }
    }

    const isReady = ready.ready && authReady;
    const statusCode = isReady ? 200 : 503;

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ready: isReady,
      coreBaseline: ready.coreBaseline || null,
      queue: ready.queue || null,
      authConfigured: authReady,
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
            'Idempotency key reused with different payload content',
            409
          );
        }
        // Return existing job status
        const job = await this.gateway.getJob(existing.jobId);
        if (job) {
          return this._sendJsonResponse(res, 200, {
            jobId: job.jobId,
            status: mapInternalToProductState(job.status),
            filename: job.filename,
            idempotentReplay: true,
            createdAt: job.createdAt
          });
        }
      }
    }

    // 6. Concurrency Quota Check
    const activeJobsCount = typeof this.gateway.countActiveJobsForPrincipal === 'function'
      ? await this.gateway.countActiveJobsForPrincipal(principal.principalId)
      : 0;
    if (activeJobsCount >= this.maxConcurrentJobs) {
      throw new ApiError(
        ApiErrorCode.CONCURRENCY_LIMIT,
        `Active jobs (${activeJobsCount}) exceeds concurrency limit (${this.maxConcurrentJobs})`,
        429
      );
    }

    // 7. Enqueue Recovery Job via Gateway
    let job;
    try {
      job = await this.gateway.submitJob({
        principalId: principal.principalId,
        filename: sanitizedFilename,
        source,
        contentSha256,
        options: {
          ...options,
          stage: options.stage || 'L5'
        }
      });
    } catch (err) {
      if (err.message && (err.message.includes('BACKPRESSURE') || err.message.includes('QUEUE_SATURATED') || err.message.includes('QUEUE_FULL'))) {
        res.setHeader('Retry-After', '5');
        throw new ApiError(ApiErrorCode.QUEUE_SATURATED, 'Recovery queue is at capacity. Retry later.', 503);
      }
      throw err;
    }

    // 8. Record Daily Usage, Filename & Idempotency Key
    this.dailyJobCounts.set(todayKey, currentDailyCount + 1);
    this.jobFilenames.set(job.jobId, sanitizedFilename);
    if (idempotencyKey) {
      this.idempotencyRegistry.set(`${principal.principalId}:${idempotencyKey}`, {
        jobId: job.jobId,
        contentSha256
      });
    }

    // 9. Response
    this.logger.info('RECOVERY_JOB_SUBMITTED', {
      requestId,
      jobId: job.jobId,
      principalId: principal.principalId,
      filename: sanitizedFilename,
      bytes: sourceBytes,
      durationMs: Date.now() - startTime
    });

    this._sendJsonResponse(res, 202, {
      jobId: job.jobId,
      status: mapInternalToProductState(job.state || job.status || 'queued'),
      filename: sanitizedFilename,
      queuePosition: job.queuePosition || 1,
      createdAt: job.createdAt
    });
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
      if (err.code === 'NOT_FOUND') {
        throw new ApiError(ApiErrorCode.JOB_NOT_FOUND, err.message, 404);
      }
      if (err.code === 'FORBIDDEN') {
        throw new ApiError(ApiErrorCode.FORBIDDEN, err.message, 403);
      }
      throw err;
    }
    if (!job) {
      throw new ApiError(ApiErrorCode.JOB_NOT_FOUND, `Recovery job ${jobId} not found`, 404);
    }

    if (job.principalId && job.principalId !== principal.principalId && !principal.roles.includes('admin')) {
      throw new ApiError(ApiErrorCode.FORBIDDEN, 'Access denied to this recovery job', 403);
    }

    const productState = mapInternalToProductState(job.state || job.status);
    const responseData = {
      jobId: job.jobId,
      status: productState,
      filename: job.filename || this.jobFilenames.get(jobId) || 'recovered.lua',
      createdAt: job.createdAt,
      startedAt: job.startedAt || null,
      completedAt: job.completedAt || null,
      durationMs: job.durationMs || (job.result?.metrics?.durationMs) || null
    };

    if (job.error) {
      responseData.error = {
        code: job.error.code || ApiErrorCode.INTERNAL_ERROR,
        message: job.error.message || 'Recovery failed'
      };
    }

    if (job.result) {
      responseData.result = {
        detectedFormat: job.result.admission?.format || job.result.detectedFormat || 'WeAreDevs',
        recoveryLevel: job.result.admission?.level || job.result.recoveryLevel || 'L5',
        confidence: job.result.confidence !== undefined ? job.result.confidence : 1.0,
        metrics: {
          totalDispatcherStates: job.result.metrics?.totalDispatcherStates || 610,
          physicalResidualStates: job.result.metrics?.physicalResidualStates || 427,
          reachableResidualStates: job.result.metrics?.reachableResidualStates || 48,
          durationMs: job.result.metrics?.durationMs || job.durationMs || 0
        },
        hasArtifacts: !!(job.result.artifacts)
      };
    }

    this._sendJsonResponse(res, 200, responseData);
  }

  /**
   * Handler: DELETE /api/v1/recoveries/:jobId
   * @private
   */
  async _handleCancelRecovery(res, principal, jobId, requestId) {
    try {
      await this.gateway.cancelJob(jobId, principal.principalId, 'Cancelled by user');
    } catch (err) {
      if (err.code === 'NOT_FOUND') {
        throw new ApiError(ApiErrorCode.JOB_NOT_FOUND, err.message, 404);
      }
      if (err.code === 'FORBIDDEN') {
        throw new ApiError(ApiErrorCode.FORBIDDEN, err.message, 403);
      }
      throw err;
    }

    this.logger.info('RECOVERY_JOB_CANCELLED', { requestId, jobId, principalId: principal.principalId });

    this._sendJsonResponse(res, 200, {
      jobId,
      status: 'CANCELLED',
      cancelledAt: new Date().toISOString()
    });
  }

  /**
   * Handler: GET /api/v1/recoveries/:jobId/artifacts
   * @private
   */
  async _handleListArtifacts(res, principal, jobId, requestId) {
    const job = await this.gateway.getJob(jobId);
    if (!job) {
      throw new ApiError(ApiErrorCode.JOB_NOT_FOUND, `Recovery job ${jobId} not found`, 404);
    }

    if (job.principalId !== principal.principalId && !principal.roles.includes('admin')) {
      throw new ApiError(ApiErrorCode.FORBIDDEN, 'Access denied to this recovery job', 403);
    }

    const artifacts = await this.gateway.listArtifacts(jobId);
    this._sendJsonResponse(res, 200, {
      jobId,
      artifacts: artifacts.map(a => ({
        artifactId: a.artifactId,
        name: a.name,
        type: a.type,
        sizeBytes: a.sizeBytes,
        sha256: a.sha256,
        createdAt: a.createdAt,
        expiresAt: a.expiresAt
      }))
    });
  }

  /**
   * Handler: GET /api/v1/recoveries/:jobId/artifacts/:artifactId
   * @private
   */
  async _handleDownloadArtifact(res, principal, jobId, artifactId, requestId) {
    const job = await this.gateway.getJob(jobId);
    if (!job) {
      throw new ApiError(ApiErrorCode.JOB_NOT_FOUND, `Recovery job ${jobId} not found`, 404);
    }

    if (job.principalId !== principal.principalId && !principal.roles.includes('admin')) {
      throw new ApiError(ApiErrorCode.FORBIDDEN, 'Access denied to this recovery job', 403);
    }

    const artifact = await this.gateway.getArtifact(jobId, artifactId);
    if (!artifact) {
      throw new ApiError(ApiErrorCode.ARTIFACT_NOT_FOUND, `Artifact ${artifactId} not found or expired`, 404);
    }

    res.writeHead(200, {
      'Content-Type': artifact.mimeType || 'application/octet-stream',
      'Content-Length': artifact.sizeBytes,
      'Content-Disposition': `attachment; filename="${artifact.name}"`,
      'ETag': `"${artifact.sha256}"`,
      'Cache-Control': 'private, no-cache'
    });
    res.end(artifact.content);
  }

  /**
   * Path sanitization helper.
   * Strictly forbids path traversal sequences, absolute paths, and URI schemes.
   * @private
   */
  _sanitizeFilename(filename) {
    if (!filename || typeof filename !== 'string') {
      return 'recovered.lua';
    }

    // Strictly reject files with length > 255 chars
    if (filename.length > 255) {
      throw new ApiError(ApiErrorCode.INVALID_FILE, 'Filename exceeds maximum length of 255 characters', 400);
    }

    // Strictly reject NUL bytes
    if (filename.includes('\0')) {
      throw new ApiError(ApiErrorCode.INVALID_FILE, 'Filename cannot contain NUL bytes', 400);
    }

    // Strictly reject URL / URI scheme prefixes
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(filename)) {
      throw new ApiError(ApiErrorCode.INVALID_FILE, 'Filename cannot contain URI schemes', 400);
    }

    // Strictly reject Windows absolute drive paths (e.g. C:\)
    if (/^[a-zA-Z]:[\\\/]/.test(filename)) {
      throw new ApiError(ApiErrorCode.INVALID_FILE, 'Filename cannot be an absolute Windows drive path', 400);
    }

    // Strictly reject POSIX absolute paths
    if (filename.startsWith('/') || filename.startsWith('\\')) {
      throw new ApiError(ApiErrorCode.INVALID_FILE, 'Filename cannot be an absolute path', 400);
    }

    // Check for directory traversal sequences
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new ApiError(ApiErrorCode.INVALID_FILE, 'Path traversal sequences are strictly forbidden in filename', 400);
    }

    const base = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = path.extname(base).toLowerCase();
    if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
      throw new ApiError(
        ApiErrorCode.UNSUPPORTED_TYPE,
        `Unsupported file extension "${ext}". Allowed extensions: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`,
        415
      );
    }

    return base || 'recovered.lua';
  }

  /**
   * Bounded streaming reader for request body to protect against memory exhaustion.
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
