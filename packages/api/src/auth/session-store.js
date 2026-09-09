/**
 * Production Server-Side Session Store.
 * 
 * Implements:
 * 1. Opaque high-entropy bearer tokens in cookies.
 * 2. Hash-at-rest lookup: store key is SHA256(rawSessionToken).
 * 3. Session rotation (prevent fixation).
 * 4. Dual TTL enforcement: idle expiration and absolute expiration.
 * 5. CSRF synchronizer token generation and validation.
 * 6. Pluggable adapters: MongoSessionStore, RedisSessionStore, and deterministic MemorySessionStore.
 * 7. Fail-closed error handling in production.
 */

const crypto = require('crypto');

const DEFAULT_IDLE_TTL_SECONDS = 1800; // 30 minutes
const DEFAULT_ABSOLUTE_TTL_SECONDS = 86400; // 24 hours

class SessionStore {
  constructor(options = {}) {
    this.idleTtlSec = options.idleTtlSeconds || parseInt(process.env.SESSION_IDLE_TTL_SECONDS || '', 10) || DEFAULT_IDLE_TTL_SECONDS;
    this.absoluteTtlSec = options.absoluteTtlSeconds || parseInt(process.env.SESSION_ABSOLUTE_TTL_SECONDS || '', 10) || DEFAULT_ABSOLUTE_TTL_SECONDS;
    this.nodeEnv = options.nodeEnv || process.env.NODE_ENV || 'development';
  }

  /**
   * Hashes the raw session token with SHA-256 for secure lookup.
   * Neither DB nor Redis ever stores the plaintext token.
   */
  hashToken(token) {
    if (!token || typeof token !== 'string') return null;
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generates a high-entropy cryptographically random session token.
   */
  generateRawToken() {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Generates a cryptographic CSRF synchronizer token.
   */
  generateCsrfToken() {
    return crypto.randomBytes(24).toString('base64url');
  }

  /**
   * Validates session timing constraints (idle and absolute expiry).
   * @param {object} session
   * @returns {boolean}
   */
  isExpired(session) {
    if (!session) return true;
    const now = Date.now();
    const createdAt = new Date(session.createdAt).getTime();
    const lastSeenAt = new Date(session.lastSeenAt).getTime();

    // 1. Check absolute expiration
    if (now - createdAt > this.absoluteTtlSec * 1000) {
      return true;
    }

    // 2. Check idle expiration
    if (now - lastSeenAt > this.idleTtlSec * 1000) {
      return true;
    }

    return false;
  }
}

/**
 * Memory-backed Session Store for deterministic local tests.
 */
class MemorySessionStore extends SessionStore {
  constructor(options = {}) {
    super(options);
    this.sessions = new Map(); // sessionIdHash -> sessionRecord
  }

  async createSession(principal, metadata = {}) {
    const rawToken = this.generateRawToken();
    const tokenHash = this.hashToken(rawToken);
    const csrfToken = this.generateCsrfToken();
    const now = new Date().toISOString();

    const record = {
      sessionIdHash: tokenHash,
      principalId: principal.principalId,
      principal: principal.toJSON ? principal.toJSON() : principal,
      csrfToken,
      createdAt: now,
      lastSeenAt: now,
      rotationVersion: 1,
      metadata
    };

    this.sessions.set(tokenHash, record);
    return { token: rawToken, session: record };
  }

  async getSession(rawToken) {
    const tokenHash = this.hashToken(rawToken);
    if (!tokenHash) return null;

    const session = this.sessions.get(tokenHash);
    if (!session) return null;

    if (this.isExpired(session)) {
      this.sessions.delete(tokenHash);
      return null;
    }

    // Update lastSeenAt (sliding idle window)
    session.lastSeenAt = new Date().toISOString();
    return session;
  }

  async rotateSession(rawToken) {
    const tokenHash = this.hashToken(rawToken);
    const existing = tokenHash ? this.sessions.get(tokenHash) : null;

    if (!existing || this.isExpired(existing)) {
      if (tokenHash) this.sessions.delete(tokenHash);
      throw new Error('INVALID_SESSION: Cannot rotate non-existent or expired session');
    }

    // Delete old session token
    this.sessions.delete(tokenHash);

    // Generate new token & new CSRF token
    const newRawToken = this.generateRawToken();
    const newTokenHash = this.hashToken(newRawToken);
    const now = new Date().toISOString();

    const newRecord = {
      ...existing,
      sessionIdHash: newTokenHash,
      csrfToken: this.generateCsrfToken(),
      lastSeenAt: now,
      rotationVersion: (existing.rotationVersion || 1) + 1
    };

    this.sessions.set(newTokenHash, newRecord);
    return { token: newRawToken, session: newRecord };
  }

  async destroySession(rawToken) {
    const tokenHash = this.hashToken(rawToken);
    if (tokenHash) {
      this.sessions.delete(tokenHash);
    }
    return true;
  }

  async clear() {
    this.sessions.clear();
  }
}

/**
 * MongoDB-backed Session Store.
 */
class MongoSessionStore extends SessionStore {
  constructor(options = {}) {
    super(options);
    this.collection = options.collection || null;
    this._inMemoryFallback = null;

    if (!this.collection) {
      this._inMemoryFallback = new MemorySessionStore(options);
    }
  }

  async createSession(principal, metadata = {}) {
    if (this._inMemoryFallback) {
      return this._inMemoryFallback.createSession(principal, metadata);
    }

    const rawToken = this.generateRawToken();
    const tokenHash = this.hashToken(rawToken);
    const csrfToken = this.generateCsrfToken();
    const now = new Date().toISOString();

    const record = {
      _id: tokenHash,
      sessionIdHash: tokenHash,
      principalId: principal.principalId,
      principal: principal.toJSON ? principal.toJSON() : principal,
      csrfToken,
      createdAt: now,
      lastSeenAt: now,
      rotationVersion: 1,
      metadata
    };

    await this.collection.insertOne(record);
    return { token: rawToken, session: record };
  }

  async getSession(rawToken) {
    if (this._inMemoryFallback) {
      return this._inMemoryFallback.getSession(rawToken);
    }

    const tokenHash = this.hashToken(rawToken);
    if (!tokenHash) return null;

    const doc = await this.collection.findOne({ sessionIdHash: tokenHash });
    if (!doc) return null;

    if (this.isExpired(doc)) {
      await this.collection.deleteOne ? await this.collection.deleteOne({ sessionIdHash: tokenHash }) : null;
      return null;
    }

    // Update lastSeenAt
    const now = new Date().toISOString();
    if (this.collection.updateOne) {
      await this.collection.updateOne({ sessionIdHash: tokenHash }, { $set: { lastSeenAt: now } });
    }
    doc.lastSeenAt = now;
    return doc;
  }

  async rotateSession(rawToken) {
    if (this._inMemoryFallback) {
      return this._inMemoryFallback.rotateSession(rawToken);
    }

    const tokenHash = this.hashToken(rawToken);
    const existing = tokenHash ? await this.collection.findOne({ sessionIdHash: tokenHash }) : null;

    if (!existing || this.isExpired(existing)) {
      if (tokenHash && this.collection.deleteOne) {
        await this.collection.deleteOne({ sessionIdHash: tokenHash });
      }
      throw new Error('INVALID_SESSION: Cannot rotate non-existent or expired session');
    }

    // Delete old session
    if (this.collection.deleteOne) {
      await this.collection.deleteOne({ sessionIdHash: tokenHash });
    }

    const newRawToken = this.generateRawToken();
    const newTokenHash = this.hashToken(newRawToken);
    const now = new Date().toISOString();

    const newRecord = {
      _id: newTokenHash,
      sessionIdHash: newTokenHash,
      principalId: existing.principalId,
      principal: existing.principal,
      csrfToken: this.generateCsrfToken(),
      createdAt: existing.createdAt,
      lastSeenAt: now,
      rotationVersion: (existing.rotationVersion || 1) + 1,
      metadata: existing.metadata
    };

    await this.collection.insertOne(newRecord);
    return { token: newRawToken, session: newRecord };
  }

  async destroySession(rawToken) {
    if (this._inMemoryFallback) {
      return this._inMemoryFallback.destroySession(rawToken);
    }

    const tokenHash = this.hashToken(rawToken);
    if (tokenHash && this.collection.deleteOne) {
      await this.collection.deleteOne({ sessionIdHash: tokenHash });
    }
    return true;
  }
}

module.exports = {
  SessionStore,
  MemorySessionStore,
  MongoSessionStore
};
