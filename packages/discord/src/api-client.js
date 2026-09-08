/**
 * Product API HTTP Client for Discord Bot Adapter.
 * 
 * Transmits bot service credentials and HMAC-SHA256 signed principal assertions.
 * Communicates strictly over standard HTTP REST interface to Product API.
 * Never accesses database, worker, core, or queue directly.
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const url = require('url');

class ProductApiClient {
  /**
   * @param {object} options
   * @param {string} options.apiBaseUrl - e.g. 'http://127.0.0.1:3000'
   * @param {string} [options.serviceSecret] - INTERNAL_BOT_SERVICE_SECRET
   */
  constructor(options = {}) {
    if (!options.apiBaseUrl) {
      throw new Error('apiBaseUrl is required for ProductApiClient');
    }
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, '');
    this.serviceSecret = options.serviceSecret || process.env.INTERNAL_BOT_SERVICE_SECRET || 'valax-bot-service-secret';
  }

  /**
   * Signs a principal assertion token for the invoking Discord user.
   * @param {string} discordUserId
   * @param {object} [metadata]
   * @returns {string} HMAC-SHA256 signed assertion
   */
  createPrincipalAssertion(discordUserId, metadata = {}) {
    if (!discordUserId || typeof discordUserId !== 'string') {
      throw new Error('discordUserId is required for principal assertion');
    }

    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'valax-discord-bot',
      aud: 'valax-product-api',
      sub: discordUserId,
      provider: 'discord',
      providerSubject: discordUserId,
      iat: now,
      exp: now + 300, // 5 minutes expiry
      nonce: crypto.randomBytes(16).toString('hex'),
      metadata: {
        username: metadata.username || null,
        global_name: metadata.global_name || null
      }
    })).toString('base64url');

    const signature = crypto.createHmac('sha256', this.serviceSecret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    return `${header}.${payload}.${signature}`;
  }

  /**
   * Submits a recovery job to Product API as the given Discord user.
   */
  async submitRecovery(discordUserId, { filename, source, options = {} }, metadata = {}) {
    const assertion = this.createPrincipalAssertion(discordUserId, metadata);
    const body = JSON.stringify({ filename, source, options });

    return this._request('/api/v1/recoveries', {
      method: 'POST',
      assertion,
      body,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Retrieves recovery job status as the given Discord user.
   */
  async getRecovery(discordUserId, jobId, metadata = {}) {
    const assertion = this.createPrincipalAssertion(discordUserId, metadata);
    return this._request(`/api/v1/recoveries/${jobId}`, {
      method: 'GET',
      assertion
    });
  }

  /**
   * Cancels recovery job as the given Discord user.
   */
  async cancelRecovery(discordUserId, jobId, metadata = {}) {
    const assertion = this.createPrincipalAssertion(discordUserId, metadata);
    return this._request(`/api/v1/recoveries/${jobId}`, {
      method: 'DELETE',
      assertion
    });
  }

  /**
   * Lists artifacts for a completed recovery job.
   */
  async listArtifacts(discordUserId, jobId, metadata = {}) {
    const assertion = this.createPrincipalAssertion(discordUserId, metadata);
    return this._request(`/api/v1/recoveries/${jobId}/artifacts`, {
      method: 'GET',
      assertion
    });
  }

  /**
   * Downloads artifact content for a completed recovery job.
   */
  async downloadArtifact(discordUserId, jobId, artifactId, metadata = {}) {
    const assertion = this.createPrincipalAssertion(discordUserId, metadata);
    return this._request(`/api/v1/recoveries/${jobId}/artifacts/${artifactId}`, {
      method: 'GET',
      assertion,
      returnBuffer: true
    });
  }

  /**
   * Internal HTTP request helper.
   * @private
   */
  _request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const fullUrl = new URL(this.apiBaseUrl + path);
      const isHttps = fullUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const headers = {
        'User-Agent': 'Valax-Discord-Bot/1.0',
        'Authorization': `Bearer ${this.serviceSecret}`,
        'X-Principal-Assertion': options.assertion,
        ...(options.headers || {})
      };

      if (options.body) {
        headers['Content-Length'] = Buffer.byteLength(options.body, 'utf8');
      }

      const req = transport.request(fullUrl, {
        method: options.method || 'GET',
        headers
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (options.returnBuffer) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              return resolve({ statusCode: res.statusCode, data: buf, headers: res.headers });
            }
          }
          let json = null;
          try {
            json = JSON.parse(buf.toString('utf8'));
          } catch (_) {}

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, json, data: buf.toString('utf8') });
          } else {
            const err = new Error(json?.error?.message || `API error HTTP ${res.statusCode}`);
            err.statusCode = res.statusCode;
            err.code = json?.error?.code || 'API_ERROR';
            err.responseJson = json;
            reject(err);
          }
        });
      });

      req.on('error', reject);
      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }
}

module.exports = {
  ProductApiClient
};
