/**
 * Mock Discord OAuth2 Server for Deterministic CI and Unit/E2E Testing.
 * 
 * Emulates:
 * 1. GET  /oauth2/authorize
 * 2. POST /api/oauth2/token (with PKCE verification)
 * 3. GET  /api/users/@me
 * 
 * Accurately labeled for CI: DISCORD_OAUTH_PROTOCOL_E2E (Mock Server).
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');

class MockDiscordOAuthServer {
  /**
   * @param {object} [options]
   * @param {string} [options.expectedClientId='mock-discord-client-id']
   * @param {string} [options.expectedClientSecret='mock-discord-client-secret']
   */
  constructor(options = {}) {
    this.expectedClientId = options.expectedClientId || 'mock-discord-client-id';
    this.expectedClientSecret = options.expectedClientSecret || 'mock-discord-client-secret';

    // In-flight authorization codes: code -> { clientId, redirectUri, codeChallenge, userId }
    this.issuedCodes = new Map();

    // In-flight access tokens: token -> { userId, expiresAt }
    this.issuedTokens = new Map();

    // User directory: userId -> userProfile
    this.users = new Map([
      ['123456789012345678', {
        id: '123456789012345678',
        username: 'alice_dev',
        discriminator: '0001',
        global_name: 'Alice Developer',
        avatar: 'a_1234567890abcdef1234567890abcdef'
      }],
      ['987654321098765432', {
        id: '987654321098765432',
        username: 'bob_researcher',
        discriminator: '0002',
        global_name: 'Bob Researcher',
        avatar: 'b_abcdef1234567890abcdef1234567890'
      }]
    ]);

    this.server = http.createServer(this._handleRequest.bind(this));
    this.port = null;
  }

  start(port = 0) {
    return new Promise((resolve, reject) => {
      this.server.listen(port, () => {
        const addr = this.server.address();
        this.port = typeof addr === 'object' && addr ? addr.port : port;
        resolve(this.port);
      });
      this.server.on('error', reject);
    });
  }

  close() {
    return new Promise(resolve => {
      if (!this.server.listening) return resolve();
      this.server.close(resolve);
    });
  }

  getBaseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  addUser(userId, profile) {
    this.users.set(userId, profile);
  }

  _handleRequest(req, res) {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;
    const method = req.method.toUpperCase();

    // 1. GET /oauth2/authorize
    if (pathname === '/oauth2/authorize' && method === 'GET') {
      const { client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method } = parsed.query;

      if (!client_id || !redirect_uri || !state) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'invalid_request', error_description: 'Missing required parameters' }));
      }

      // Generate authorization code for default user Alice
      const code = `discord-auth-code-${crypto.randomBytes(16).toString('hex')}`;
      this.issuedCodes.set(code, {
        clientId: client_id,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method,
        userId: '123456789012345678'
      });

      const redirectTarget = new URL(redirect_uri);
      redirectTarget.searchParams.set('code', code);
      redirectTarget.searchParams.set('state', state);

      res.statusCode = 302;
      res.setHeader('Location', redirectTarget.toString());
      return res.end();
    }

    // 2. POST /api/oauth2/token
    if (pathname === '/api/oauth2/token' && method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const clientId = params.get('client_id');
        const clientSecret = params.get('client_secret');
        const code = params.get('code');
        const codeVerifier = params.get('code_verifier');
        const grantType = params.get('grant_type');

        if (grantType !== 'authorization_code') {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'unsupported_grant_type' }));
        }

        if (clientId !== this.expectedClientId || clientSecret !== this.expectedClientSecret) {
          res.statusCode = 401;
          return res.end(JSON.stringify({ error: 'invalid_client' }));
        }

        const issued = this.issuedCodes.get(code);
        if (!issued) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Code already used or invalid' }));
        }
        this.issuedCodes.delete(code); // Single-use code

        // Verify PKCE if challenge was provided
        if (issued.codeChallenge) {
          if (!codeVerifier) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'code_verifier required' }));
          }
          const actualChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
          if (actualChallenge !== issued.codeChallenge) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'PKCE challenge mismatch' }));
          }
        }

        const accessToken = `discord-token-canary-${crypto.randomBytes(20).toString('hex')}`;
        this.issuedTokens.set(accessToken, {
          userId: issued.userId,
          expiresAt: Date.now() + 3600 * 1000
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'identify'
        }));
      });
      return;
    }

    // 3. GET /api/users/@me
    if (pathname === '/api/users/@me' && method === 'GET') {
      const auth = req.headers['authorization'];
      if (!auth || !auth.startsWith('Bearer ')) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ message: '401: Unauthorized', code: 0 }));
      }

      const token = auth.substring(7);
      const tokenRecord = this.issuedTokens.get(token);
      if (!tokenRecord || Date.now() > tokenRecord.expiresAt) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ message: '401: Unauthorized', code: 0 }));
      }

      const user = this.users.get(tokenRecord.userId);
      if (!user) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ message: 'User not found' }));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(user));
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
  }
}

module.exports = {
  MockDiscordOAuthServer
};
