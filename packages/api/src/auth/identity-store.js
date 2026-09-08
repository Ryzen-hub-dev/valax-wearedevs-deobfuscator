/**
 * Durable MongoDB Identity Mapping Store.
 * 
 * Maps external identity subjects (e.g. Discord user ID) to internal stable UUID principalIds.
 * Enforces account uniqueness via compound unique index (provider, providerSubject)
 * and guarantees concurrency-safe resolution.
 */

const crypto = require('crypto');
const net = require('net');
const { Principal } = require('../auth');

/**
 * Deterministic in-memory MongoDB-compatible collection for zero-dependency test suites.
 */
class MemoryMongoCollection {
  constructor(name) {
    this.name = name;
    this.documents = [];
    this.indexes = [];
  }

  createIndex(keySpec, options = {}) {
    this.indexes.push({ keySpec, options });
    return Promise.resolve(Object.keys(keySpec).join('_'));
  }

  async findOne(query) {
    for (const doc of this.documents) {
      let match = true;
      for (const [k, v] of Object.entries(query)) {
        if (doc[k] !== v) {
          match = false;
          break;
        }
      }
      if (match) return JSON.parse(JSON.stringify(doc));
    }
    return null;
  }

  async insertOne(doc) {
    // Enforce unique indexes
    for (const idx of this.indexes) {
      if (idx.options && idx.options.unique) {
        const conflict = await this.findOne(
          Object.fromEntries(Object.keys(idx.keySpec).map(k => [k, doc[k]]))
        );
        if (conflict) {
          const err = new Error(`E11000 duplicate key error collection: ${this.name} index: unique_idx dup key`);
          err.code = 11000;
          throw err;
        }
      }
    }
    const cloned = JSON.parse(JSON.stringify(doc));
    if (!cloned._id) cloned._id = crypto.randomUUID();
    this.documents.push(cloned);
    return { insertedId: cloned._id, acknowledged: true };
  }

  async updateOne(filter, update, options = {}) {
    const doc = await this.findOne(filter);
    if (!doc) {
      if (options.upsert) {
        const newDoc = { ...filter };
        if (update.$set) Object.assign(newDoc, update.$set);
        if (update.$setOnInsert) Object.assign(newDoc, update.$setOnInsert);
        const res = await this.insertOne(newDoc);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: res.insertedId };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }
    const actual = this.documents.find(d => d._id === doc._id);
    if (update.$set) Object.assign(actual, update.$set);
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async countDocuments(query = {}) {
    let count = 0;
    for (const doc of this.documents) {
      let match = true;
      for (const [k, v] of Object.entries(query)) {
        if (doc[k] !== v) { match = false; break; }
      }
      if (match) count++;
    }
    return count;
  }
}

/**
 * MongoIdentityStore:
 * Resolves (provider, providerSubject) -> Principal
 * Backed by MongoDB collection 'identities'.
 */
class MongoIdentityStore {
  /**
   * @param {object} [options]
   * @param {string} [options.mongoUri]
   * @param {object} [options.collection]
   */
  constructor(options = {}) {
    this.mongoUri = options.mongoUri || process.env.MONGODB_URI || null;
    this.collection = options.collection || null;
    this._inMemory = false;
    this._lockMap = new Map(); // Mutex for race-safe getOrCreate
    
    if (!this.collection) {
      this.collection = new MemoryMongoCollection('identities');
      this._inMemory = true;
    }

    // Initialize unique index
    this._initPromise = this.collection.createIndex(
      { provider: 1, providerSubject: 1 },
      { unique: true }
    );
  }

  /**
   * Resolves or atomically creates a Principal from an external identity.
   *
   * @param {'discord'} provider
   * @param {string} providerSubject - External user ID (e.g. Discord snowflake)
   * @param {object} [metadata]
   * @returns {Promise<Principal>}
   */
  async getOrCreatePrincipal(provider, providerSubject, metadata = {}) {
    if (!provider || typeof provider !== 'string') {
      throw new Error('INVALID_PROVIDER: provider is required');
    }
    if (!providerSubject || typeof providerSubject !== 'string') {
      throw new Error('INVALID_PROVIDER_SUBJECT: providerSubject is required');
    }

    await this._initPromise;

    const lockKey = `${provider}:${providerSubject}`;
    // Await any pending race condition for this exact subject
    while (this._lockMap.has(lockKey)) {
      await this._lockMap.get(lockKey);
    }

    let releaseLock;
    const lockPromise = new Promise(resolve => { releaseLock = resolve; });
    this._lockMap.set(lockKey, lockPromise);

    try {
      // 1. Check existing mapping
      const existing = await this.collection.findOne({
        provider,
        providerSubject
      });

      if (existing) {
        return new Principal({
          principalId: existing.principalId,
          provider: existing.provider,
          providerSubject: existing.providerSubject,
          roles: existing.roles || ['user']
        });
      }

      // 2. Create new internal Principal with random UUID
      const principalId = crypto.randomUUID();
      const now = new Date().toISOString();
      const newDoc = {
        principalId,
        provider,
        providerSubject,
        roles: ['user'],
        metadata: {
          username: metadata.username || null,
          discriminator: metadata.discriminator || null,
          avatar: metadata.avatar || null,
          ...metadata
        },
        createdAt: now,
        updatedAt: now
      };

      try {
        await this.collection.insertOne(newDoc);
      } catch (err) {
        // In case of parallel race condition caught by unique index, re-read
        if (err.code === 11000 || err.message?.includes('duplicate key')) {
          const raceFound = await this.collection.findOne({ provider, providerSubject });
          if (raceFound) {
            return new Principal({
              principalId: raceFound.principalId,
              provider: raceFound.provider,
              providerSubject: raceFound.providerSubject,
              roles: raceFound.roles || ['user']
            });
          }
        }
        throw err;
      }

      return new Principal({
        principalId,
        provider,
        providerSubject,
        roles: newDoc.roles
      });

    } finally {
      this._lockMap.delete(lockKey);
      releaseLock();
    }
  }

  /**
   * Retrieves principal by provider and subject.
   */
  async getBySubject(provider, providerSubject) {
    await this._initPromise;
    const doc = await this.collection.findOne({ provider, providerSubject });
    if (!doc) return null;
    return new Principal({
      principalId: doc.principalId,
      provider: doc.provider,
      providerSubject: doc.providerSubject,
      roles: doc.roles || ['user']
    });
  }

  /**
   * Retrieves principal by internal principalId.
   */
  async getByPrincipalId(principalId) {
    await this._initPromise;
    const doc = await this.collection.findOne({ principalId });
    if (!doc) return null;
    return new Principal({
      principalId: doc.principalId,
      provider: doc.provider,
      providerSubject: doc.providerSubject,
      roles: doc.roles || ['user']
    });
  }
}

module.exports = {
  MongoIdentityStore,
  MemoryMongoCollection
};
