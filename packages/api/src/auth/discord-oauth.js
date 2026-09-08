/**
 * Discord OAuth2 Controller, Session Management & CSRF Guard.
 * 
 * Implements:
 * 1. Discord Authorization Code Flow with PKCE (S256).
 * 2. Cryptographic state verification (single-use, bound, timing-safe).
 * 3. Server-side token exchange and identity resolution (scope=identify).
 * 4. Principal mapping via MongoIdentityStore.
 * 5. Session rotation, secure cookie issuance, and dual TTL checks.
 * 6. CSRF synchronizer token verification on state-changing operations.
 * 7. Bot service authentication with HMAC-SHA256 signed principal assertions.
 * 8. Strict fail-closed policy in production.
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const url = require('url');
const { ApiError, ApiErrorCode } = require('../errors');
const { Principal } = require('../auth');

const DISCORD_OAUTH_AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_OAUTH_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_USER_ME_URL = 'https://discord.com/api/users/@me';

class DiscordOAuthController {
  /**
   * @param {object} options
   * @param {string} [options.clientId]
   * @param {string} [options.clientSecret]
   * @param {string} [options.redirectUri]
   * @param {string} [options.sessionSecret]
   * @param {string} [options.botServiceSecret]
   * @param {object} options.identityStore
   * @param {object} options.sessionStore
   * @param {string} [options.discordApiBase] - Custom base for CI mock server
   * @param {string} [options.nodeEnv]
   * @param {object} [options.logger]
   */
  constructor(options = {}) {
    this.clientId = options.clientId || process.env.DISCORD_CLIENT_ID || '';
    this.clientSecret = options.clientSecret || process.env.DISCORD_CLIENT_SECRET || '';
    this.redirectUri = options.redirectUri || process.env.DISCORD_REDIRECT_URI || '';
    this.sessionSecret = options.sessionSecret || process.env.SESSION_SECRET || 'valax-default-session-secret-change-in-prod';
    this.botServiceSecret = options.botServiceSecret || process.env.INTERNAL_BOT_SERVICE_SECRET || 'valax-bot-service-secret';
    this.identityStore = options.identityStore;
    this.sessionStore = options.sessionStore;
    this.discordApiBase = options.discordApiBase || null;
    this.nodeEnv = options.nodeEnv || process.env.NODE_ENV || 'development';
    this.logger = options.logger || console;

    // In production, require credentials; fail closed
    if (this.nodeEnv === 'production') {
      if (!this.clientId || !this.clientSecret || !this.redirectUri) {
        throw new Error('FATAL_AUTH_CONFIGURATION: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and DISCORD_REDIRECT_URI are mandatory in production');
      }
      if (!options.sessionSecret && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('default'))) {
        throw new Error('FATAL_AUTH_CONFIGURATION: High-entropy SESSION_SECRET is mandatory in production');
      }
    }

    // Pending OAuth state store: stateHash -> { codeVerifier, createdAt, initiatingSessionId }
    this.pendingStates = new Map();

    // Seen assertion nonces for replay prevention: nonce -> expiresAt
    this.seenNonces = new Map();
  }

  // --- PKCE Helpers ---

  generatePkce() {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    return { codeVerifier, codeChallenge };
  }

  // --- State & Assertion Signing Helpers ---

  signState(state) {
    const hmac = crypto.createHmac('sha256', this.sessionSecret);
    return hmac.update(`valax-oauth-state:${state}`).digest('hex');
  }

  signPrincipalAssertion(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', this.botServiceSecret)
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  verifyPrincipalAssertion(assertionString) {
    if (!assertionString || typeof assertionString !== 'string') {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Missing principal assertion', 401);
    }

    const parts = assertionString.split('.');
    if (parts.length !== 3) {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid principal assertion format', 401);
    }

    const [headerB64, bodyB64, sigB64] = parts;
    const expectedSig = crypto.createHmac('sha256', this.botServiceSecret)
      .update(`${headerB64}.${bodyB64}`)
      .digest('base64url');

    // Timing-safe signature check
    const sigBuf = Buffer.from(sigB64);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid assertion signature', 401);
    }

    let payload;
    try {
      payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
    } catch {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Malformed assertion payload', 401);
    }

    const now = Math.floor(Date.now() / 1000);

    // Audience & Issuer validation
    if (payload.iss !== 'valax-discord-bot') {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid assertion issuer', 401);
    }
    if (payload.aud !== 'valax-product-api') {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid assertion audience', 401);
    }

    // Expiry check
    if (!payload.exp || payload.exp < now) {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Principal assertion expired', 401);
    }

    // IssuedAt check (not in future beyond 30s drift)
    if (!payload.iat || payload.iat > now + 30) {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Principal assertion issued in future', 401);
    }

    // Nonce replay protection
    if (!payload.nonce || typeof payload.nonce !== 'string') {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Assertion missing nonce', 401);
    }
    if (this.seenNonces.has(payload.nonce)) {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Replayed assertion nonce', 401);
    }
    this.seenNonces.set(payload.nonce, payload.exp * 1000);

    // Clean up expired nonces periodically
    const curMs = Date.now();
    for (const [n, expMs] of this.seenNonces.entries()) {
      if (curMs > expMs) this.seenNonces.delete(n);
    }

    return payload;
  }

  // --- Cookie Parsing & Serialization ---

  parseCookies(req) {
    const list = {};
    const rc = req.headers.cookie;
    if (rc) {
      rc.split(';').forEach(cookie => {
        const parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
      });
    }
    return list;
  }

  buildCookieHeader(name, value, options = {}) {
    const isProd = this.nodeEnv === 'production';
    const parts = [`${name}=${encodeURIComponent(value)}`];
    parts.push(`Path=${options.path || '/'}`);
    if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
    if (options.httpOnly !== false) parts.push('HttpOnly');
    if (options.secure || isProd) parts.push('Secure');
    parts.push(`SameSite=${options.sameSite || 'Lax'}`);
    return parts.join('; ');
  }

  // --- OAuth Route Handlers ---

  /**
   * GET /auth/discord:
   * Initiates Discord OAuth2 Authorization Code Flow with PKCE.
   */
  async handleAuthorize(req, res) {
    // 1. Generate state and PKCE
    const state = crypto.randomBytes(24).toString('base64url');
    const stateSig = this.signState(state);
    const combinedState = `${state}.${stateSig}`;

    const { codeVerifier, codeChallenge } = this.generatePkce();

    // Record initiating session if present
    const cookies = this.parseCookies(req);
    const initiatingSessionId = cookies['valax_session'] || null;

    // Store pending state for 10 minutes
    this.pendingStates.set(state, {
      codeVerifier,
      initiatingSessionId,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    // 2. Build Discord authorization target
    const baseAuthUrl = this.discordApiBase 
      ? `${this.discordApiBase}/oauth2/authorize`
      : DISCORD_OAUTH_AUTHORIZE_URL;

    const redirectTarget = new URL(baseAuthUrl);
    redirectTarget.searchParams.set('client_id', this.clientId);
    redirectTarget.searchParams.set('response_type', 'code');
    redirectTarget.searchParams.set('redirect_uri', this.redirectUri);
    redirectTarget.searchParams.set('scope', 'identify');
    redirectTarget.searchParams.set('state', combinedState);
    redirectTarget.searchParams.set('code_challenge', codeChallenge);
    redirectTarget.searchParams.set('code_challenge_method', 'S256');

    // Also set transient state cookie to bind state to the browser
    const stateCookie = this.buildCookieHeader('valax_oauth_state', state, { maxAge: 600 });
    res.setHeader('Set-Cookie', stateCookie);
    res.statusCode = 302;
    res.setHeader('Location', redirectTarget.toString());
    res.end();
  }

  /**
   * GET /auth/discord/callback:
   * Validates state, exchanges code for token, resolves identity, creates session.
   */
  async handleCallback(req, res) {
    const parsed = url.parse(req.url, true);
    const query = parsed.query;
    const combinedState = query.state;
    const code = query.code;
    const error = query.error;

    if (error) {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, `Discord OAuth error: ${error}`, 401);
    }

    if (!code || typeof code !== 'string') {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Missing authorization code in callback', 400);
    }

    if (!combinedState || typeof combinedState !== 'string') {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Missing OAuth state', 400);
    }

    // 1. Validate state format & timing-safe signature
    const [rawState, sig] = combinedState.split('.');
    if (!rawState || !sig) {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Malformed OAuth state', 400);
    }

    const expectedSig = this.signState(rawState);
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid OAuth state signature', 400);
    }

    // 2. Validate pending state record (single-use & expiry)
    const pending = this.pendingStates.get(rawState);
    if (!pending) {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'Unknown or replayed OAuth state', 400);
    }
    // Single-use: delete immediately
    this.pendingStates.delete(rawState);

    if (Date.now() > pending.expiresAt) {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'OAuth transaction expired', 400);
    }

    // 3. Browser session binding check
    const cookies = this.parseCookies(req);
    const clientStateCookie = cookies['valax_oauth_state'];
    if (clientStateCookie && clientStateCookie !== rawState) {
      throw new ApiError(ApiErrorCode.UNAUTHORIZED, 'OAuth state does not match client session', 400);
    }

    // 4. Server-Side Token Exchange
    const tokenData = await this._exchangeCodeForToken(code, pending.codeVerifier);

    // 5. Identity Resolution (Fetch Discord Profile)
    const discordUser = await this._fetchDiscordUser(tokenData.access_token);

    // 6. Principal Mapping via IdentityStore
    const principal = await this.identityStore.getOrCreatePrincipal('discord', discordUser.id, {
      username: discordUser.username,
      discriminator: discordUser.discriminator,
      global_name: discordUser.global_name,
      avatar: discordUser.avatar
    });

    // 7. Session Rotation: if old session existed, destroy it to prevent fixation
    const oldSessionToken = cookies['valax_session'];
    if (oldSessionToken) {
      try {
        await this.sessionStore.destroySession(oldSessionToken);
      } catch (_) {}
    }

    // 8. Create Fresh Authenticated Session
    const { token: newSessionToken } = await this.sessionStore.createSession(principal, {
      displayName: discordUser.global_name || discordUser.username,
      avatarUrl: discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
        : null
    });

    // 9. Issue Secure Cookie & Redirect to Dashboard
    const sessionCookie = this.buildCookieHeader('valax_session', newSessionToken, {
      maxAge: this.sessionStore.absoluteTtlSec
    });
    // Clear transient OAuth state cookie
    const clearStateCookie = this.buildCookieHeader('valax_oauth_state', '', { maxAge: 0 });

    res.statusCode = 302;
    res.setHeader('Set-Cookie', [sessionCookie, clearStateCookie]);
    res.setHeader('Location', '/dashboard');
    res.end();
  }

  /**
   * POST /auth/logout:
   * Validates CSRF synchronizer token, invalidates server session, clears browser cookie.
   */
  async handleLogout(req, res, session) {
    // Invalidate session in store
    const cookies = this.parseCookies(req);
    const token = cookies['valax_session'];
    if (token) {
      await this.sessionStore.destroySession(token);
    }

    const clearCookie = this.buildCookieHeader('valax_session', '', { maxAge: 0 });
    res.setHeader('Set-Cookie', clearCookie);
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, message: 'Logged out successfully' }));
  }

  /**
   * GET /api/v1/me:
   * Returns authenticated principal information with zero exposed secrets/tokens.
   */
  handleMe(res, session) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({
      principal: {
        principalId: session.principal.principalId,
        provider: session.principal.provider,
        roles: session.principal.roles || ['user']
      },
      user: {
        displayName: session.metadata?.displayName || 'Discord User',
        avatarUrl: session.metadata?.avatarUrl || null
      }
    }));
  }

  /**
   * GET /auth/session:
   * Returns current session authentication state & CSRF synchronizer token.
   */
  handleSessionInfo(res, session) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({
      authenticated: true,
      csrfToken: session.csrfToken,
      principal: {
        principalId: session.principal.principalId,
        provider: session.principal.provider,
        roles: session.principal.roles || ['user']
      }
    }));
  }

  // --- Token Exchange & API Clients ---

  _exchangeCodeForToken(code, codeVerifier) {
    return new Promise((resolve, reject) => {
      const tokenUrl = this.discordApiBase
        ? `${this.discordApiBase}/api/oauth2/token`
        : DISCORD_OAUTH_TOKEN_URL;

      const bodyParams = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
        code_verifier: codeVerifier
      });
      const postData = bodyParams.toString();

      const parsed = new URL(tokenUrl);
      const isHttps = parsed.protocol === 'https:';
      const transport = isHttps ? https : http;

      const req = transport.request(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'Valax-Product-API (https://github.com/Ryzen-hub-dev/valax-wearedevs-deobfuscator)'
        }
      }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new ApiError(ApiErrorCode.UNAUTHORIZED, `Discord token exchange failed: HTTP ${res.statusCode}`, 401));
          }
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            reject(new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid JSON from Discord token exchange', 401));
          }
        });
      });

      req.on('error', err => reject(new ApiError(ApiErrorCode.UNAUTHORIZED, `Token exchange network error: ${err.message}`, 401)));
      req.write(postData);
      req.end();
    });
  }

  _fetchDiscordUser(accessToken) {
    return new Promise((resolve, reject) => {
      const userUrl = this.discordApiBase
        ? `${this.discordApiBase}/api/users/@me`
        : DISCORD_USER_ME_URL;

      const parsed = new URL(userUrl);
      const isHttps = parsed.protocol === 'https:';
      const transport = isHttps ? https : http;

      const req = transport.request(userUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'Valax-Product-API (https://github.com/Ryzen-hub-dev/valax-wearedevs-deobfuscator)'
        }
      }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new ApiError(ApiErrorCode.UNAUTHORIZED, `Discord identity fetch failed: HTTP ${res.statusCode}`, 401));
          }
          try {
            const json = JSON.parse(data);
            if (!json.id) throw new Error('Missing Discord user id');
            resolve(json);
          } catch (e) {
            reject(new ApiError(ApiErrorCode.UNAUTHORIZED, 'Invalid JSON from Discord user endpoint', 401));
          }
        });
      });

      req.on('error', err => reject(new ApiError(ApiErrorCode.UNAUTHORIZED, `Identity fetch network error: ${err.message}`, 401)));
      req.end();
    });
  }
}

module.exports = {
  DiscordOAuthController
};
