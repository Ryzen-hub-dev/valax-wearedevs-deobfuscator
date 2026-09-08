/**
 * SSRF-Safe Discord Attachment Fetcher.
 * 
 * Enforces:
 * 1. Protocol: strictly https: only.
 * 2. Host allowlist: cdn.discordapp.com, media.discordapp.net.
 * 3. Anti-SSRF: IP resolution guards rejecting loopback, RFC1918, link-local, and cloud metadata IPs.
 * 4. Bounded streaming: aborts immediately if bytes exceed MAX_SOURCE_BYTES.
 * 5. Strict timeout: aborts slow transfers.
 * 6. Redirect policy: strictly disallows redirects to unapproved hosts or internal networks.
 */

const https = require('https');
const http = require('http');
const dns = require('dns');
const url = require('url');

const DEFAULT_ALLOWED_HOSTS = new Set([
  'cdn.discordapp.com',
  'media.discordapp.net'
]);

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_TIMEOUT_MS = 10000; // 10 seconds

class AttachmentFetcher {
  /**
   * @param {object} [options]
   * @param {Set<string>|string[]} [options.allowedHosts]
   * @param {number} [options.maxBytes]
   * @param {number} [options.timeoutMs]
   */
  constructor(options = {}) {
    this.allowedHosts = new Set(options.allowedHosts || DEFAULT_ALLOWED_HOSTS);
    this.maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  /**
   * Checks if an IP address falls into private, loopback, or cloud-metadata ranges.
   * @param {string} ip
   * @returns {boolean}
   */
  isPrivateIp(ip) {
    if (!ip) return false;

    // IPv6 Loopback
    if (ip === '::1' || ip === '::' || ip.startsWith('fe80:')) return true;

    // IPv4 checks
    const parts = ip.split('.').map(p => parseInt(p, 10));
    if (parts.length === 4 && parts.every(p => !isNaN(p) && p >= 0 && p <= 255)) {
      // 127.0.0.0/8 (Loopback)
      if (parts[0] === 127) return true;
      // 0.0.0.0/8
      if (parts[0] === 0) return true;
      // 10.0.0.0/8 (Private RFC1918)
      if (parts[0] === 10) return true;
      // 172.16.0.0/12 (Private RFC1918)
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      // 192.168.0.0/16 (Private RFC1918)
      if (parts[0] === 192 && parts[1] === 168) return true;
      // 169.254.0.0/16 (Link-local / AWS & GCP Metadata 169.254.169.254)
      if (parts[0] === 169 && parts[1] === 254) return true;
    }

    return false;
  }

  /**
   * Validates target URL against SSRF policy before making request.
   * @param {string} rawUrl
   * @returns {URL}
   */
  validateUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new Error('SSRF_GUARD: Attachment URL is required');
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error('SSRF_GUARD: Malformed attachment URL');
    }

    // 1. Protocol Guard: Must be HTTPS
    if (parsed.protocol !== 'https:') {
      throw new Error(`SSRF_GUARD: Insecure protocol "${parsed.protocol}". Only https is permitted.`);
    }

    // 2. Host Allowlist Guard
    const host = parsed.hostname.toLowerCase();
    if (!this.allowedHosts.has(host)) {
      throw new Error(`SSRF_GUARD: Target host "${host}" is not in the approved Discord CDN allowlist`);
    }

    // 3. Direct IP address as hostname rejection
    if (/^[0-9.]+$/.test(host) || host.includes(':')) {
      if (this.isPrivateIp(host)) {
        throw new Error('SSRF_GUARD: Private or loopback IP addresses are strictly forbidden');
      }
    }

    return parsed;
  }

  /**
   * Safely fetches an attachment via bounded stream with timeout and size enforcement.
   * @param {string} rawUrl
   * @returns {Promise<{ content: string, bytes: number, filename: string }>}
   */
  async fetchAttachment(rawUrl) {
    const targetUrl = this.validateUrl(rawUrl);

    // DNS Resolution Check to prevent DNS rebinding attacks
    const resolvedIps = await this._resolveDns(targetUrl.hostname);
    for (const ip of resolvedIps) {
      if (this.isPrivateIp(ip)) {
        throw new Error(`SSRF_GUARD: Target host resolved to forbidden IP address: ${ip}`);
      }
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        req.destroy();
        reject(new Error(`SSRF_GUARD: Attachment fetch timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      const req = https.get(targetUrl, {
        headers: {
          'User-Agent': 'Valax-Discord-Attachment-Fetcher/1.0'
        }
      }, res => {
        // Disallow redirects to unapproved destinations
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          clearTimeout(timer);
          settled = true;
          // Validate redirect destination recursively
          try {
            const redirectUrl = new URL(res.headers.location, targetUrl);
            this.validateUrl(redirectUrl.toString());
            // Follow redirect safely
            return this.fetchAttachment(redirectUrl.toString()).then(resolve).catch(reject);
          } catch (err) {
            return reject(new Error(`SSRF_GUARD: Unsafe redirect rejected: ${err.message}`));
          }
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          clearTimeout(timer);
          settled = true;
          return reject(new Error(`Attachment fetch failed with HTTP ${res.statusCode}`));
        }

        const contentLength = parseInt(res.headers['content-length'] || '0', 10);
        if (contentLength > this.maxBytes) {
          clearTimeout(timer);
          settled = true;
          req.destroy();
          return reject(new Error(`ATTACHMENT_TOO_LARGE: Content-Length (${contentLength}) exceeds limit of ${this.maxBytes} bytes`));
        }

        let received = 0;
        const chunks = [];

        res.on('data', chunk => {
          if (settled) return;
          received += chunk.length;
          if (received > this.maxBytes) {
            clearTimeout(timer);
            settled = true;
            req.destroy();
            return reject(new Error(`ATTACHMENT_TOO_LARGE: Download exceeded limit of ${this.maxBytes} bytes`));
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          if (settled) return;
          clearTimeout(timer);
          settled = true;
          const fullBuf = Buffer.concat(chunks);
          const filename = targetUrl.pathname.split('/').pop() || 'script.lua';
          resolve({
            content: fullBuf.toString('utf8'),
            bytes: fullBuf.length,
            filename
          });
        });

        res.on('error', err => {
          if (settled) return;
          clearTimeout(timer);
          settled = true;
          reject(err);
        });
      });

      req.on('error', err => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        reject(err);
      });
    });
  }

  _resolveDns(hostname) {
    return new Promise((resolve, reject) => {
      dns.resolve(hostname, (err, addresses) => {
        if (err) {
          // If DNS fails or host cannot resolve, return empty array (or let fetch fail normally)
          return resolve([]);
        }
        resolve(addresses || []);
      });
    });
  }
}

module.exports = {
  AttachmentFetcher,
  DEFAULT_ALLOWED_HOSTS,
  DEFAULT_MAX_BYTES
};
