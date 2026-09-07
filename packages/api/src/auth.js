/**
 * Provider-Independent Principal and Authentication Layer for Product API.
 */

const crypto = require('crypto');

class Principal {
  /**
   * @param {object} params
   * @param {string} params.principalId
   * @param {'development'|'discord'|'api'} params.provider
   * @param {string} params.providerSubject
   * @param {string[]} [params.roles=['user']]
   */
  constructor({ principalId, provider, providerSubject, roles = ['user'] }) {
    if (!principalId) throw new Error('principalId is required');
    if (!provider) throw new Error('provider is required');
    if (!providerSubject) throw new Error('providerSubject is required');

    this.principalId = String(principalId);
    this.provider = provider;
    this.providerSubject = String(providerSubject);
    this.roles = Array.isArray(roles) ? roles : ['user'];
  }

  toJSON() {
    return {
      principalId: this.principalId,
      provider: this.provider,
      providerSubject: this.providerSubject,
      roles: this.roles
    };
  }
}

/**
 * DevelopmentAuthProvider:
 * Strictly available ONLY when NODE_ENV !== 'production'.
 * Translates development headers into deterministic Principals.
 */
class DevelopmentAuthProvider {
  constructor(options = {}) {
    this.nodeEnv = options.nodeEnv || process.env.NODE_ENV || 'development';
    if (this.nodeEnv === 'production') {
      throw new Error('FATAL_AUTH_CONFIGURATION: DevelopmentAuthProvider cannot be initialized in production');
    }
  }

  /**
   * Authenticates incoming HTTP request in non-production environments.
   *
   * @param {object} req - IncomingMessage or headers object
   * @returns {Principal|null}
   */
  authenticate(req) {
    if (this.nodeEnv === 'production' || process.env.NODE_ENV === 'production') {
      throw new Error('SECURITY_VIOLATION: DevelopmentAuthProvider invoked under production NODE_ENV');
    }

    const headers = req.headers || {};
    const devHeader = headers['x-development-principal'] || headers['x-dev-principal'];
    const authHeader = headers['authorization'];

    let subject = null;
    if (devHeader && typeof devHeader === 'string' && devHeader.trim()) {
      subject = devHeader.trim();
    } else if (authHeader && typeof authHeader === 'string') {
      const match = authHeader.match(/^Bearer\s+dev-(.+)$/i);
      if (match) {
        subject = match[1].trim();
      }
    }

    if (!subject) {
      return null;
    }

    // Deterministic UUID generation from subject name for reproducibility in tests
    const hash = crypto.createHash('sha256').update(`valax-dev-principal:${subject}`).digest('hex');
    const principalId = [
      hash.substring(0, 8),
      hash.substring(8, 12),
      '4' + hash.substring(13, 16),
      '8' + hash.substring(17, 20),
      hash.substring(20, 32)
    ].join('-');

    return new Principal({
      principalId,
      provider: 'development',
      providerSubject: subject,
      roles: subject.includes('admin') ? ['user', 'admin'] : ['user']
    });
  }
}

module.exports = {
  Principal,
  DevelopmentAuthProvider
};
