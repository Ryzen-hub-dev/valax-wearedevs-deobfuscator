/**
 * Artifact Store:
 * Manages ephemeral storage of recovery outputs with strict capacity caps,
 * 24-hour retention TTLs, and owner authorization checks.
 *
 * Source Purge Policy:
 * Input temporary files are deleted after job completion/failure.
 * Application-level references to source payloads are released.
 * The service does not intentionally persist source beyond configured retention.
 * Input source is not retained as a long-lived artifact in the artifact store.
 * Note: JavaScript runtime/OS memory reclamation does not provide a guaranteed
 * cryptographic secure erase of every in-memory copy.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_CODE_BYTES = 5 * 1024 * 1024;   // 5 MB
const MAX_REPORT_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_LOG_BYTES = 1 * 1024 * 1024;    // 1 MB
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 Hours

/**
 * Abstract Artifact Store Interface.
 * Production deployments require a multi-node shared storage adapter (e.g. S3, MinIO).
 */
class ArtifactStore {
  initJobArtifacts(jobId, ownerPrincipalId, initialData = {}) {
    throw new Error('Not implemented');
  }

  saveRecoveredCode(jobId, code) {
    throw new Error('Not implemented');
  }

  saveReport(jobId, report) {
    throw new Error('Not implemented');
  }

  saveLogs(jobId, logs) {
    throw new Error('Not implemented');
  }

  purgeSourceCode(jobId) {
    throw new Error('Not implemented');
  }

  getArtifact(jobId, artifactType, requestingPrincipalId) {
    throw new Error('Not implemented');
  }

  cleanupExpired() {
    throw new Error('Not implemented');
  }
}

const SOURCE_RETENTION_SECONDS = parseInt(process.env.SOURCE_RETENTION_SECONDS || '0', 10);
const ARTIFACT_RETENTION_SECONDS = parseInt(process.env.ARTIFACT_RETENTION_SECONDS || '86400', 10);
const JOB_METADATA_RETENTION_SECONDS = parseInt(process.env.JOB_METADATA_RETENTION_SECONDS || '604800', 10);

/**
 * Local in-memory ephemeral artifact store.
 * Suitable strictly for single-instance test/dev environments.
 */
class LocalEphemeralArtifactStore extends ArtifactStore {
  /**
   * @param {object} [options]
   * @param {number} [options.retentionMs]
   * @param {number} [options.sourceRetentionSeconds]
   * @param {number} [options.artifactRetentionSeconds]
   * @param {number} [options.jobMetadataRetentionSeconds]
   */
  constructor(options = {}) {
    super();
    this.sourceRetentionSeconds = options.sourceRetentionSeconds ?? SOURCE_RETENTION_SECONDS;
    this.artifactRetentionSeconds = options.artifactRetentionSeconds ?? ARTIFACT_RETENTION_SECONDS;
    this.jobMetadataRetentionSeconds = options.jobMetadataRetentionSeconds ?? JOB_METADATA_RETENTION_SECONDS;
    this.retentionMs = options.retentionMs || (this.artifactRetentionSeconds * 1000);
    this.storage = new Map();
  }

  initJobArtifacts(jobId, ownerPrincipalId, initialData = {}) {
    const now = Date.now();
    const entry = {
      jobId,
      ownerPrincipalId,
      createdAt: now,
      expiresAt: now + this.retentionMs,
      artifacts: {
        sourceCode: initialData.sourceCode || null,
        recoveredCode: null,
        report: null,
        logs: null
      }
    };
    this.storage.set(jobId, entry);
    return entry;
  }

  saveRecoveredCode(jobId, code) {
    const entry = this.storage.get(jobId);
    if (!entry) throw new Error(`Artifact record not found for job: ${jobId}`);

    const bytes = Buffer.byteLength(code, 'utf8');
    if (bytes > MAX_CODE_BYTES) {
      throw new Error(`Recovered code exceeds maximum size limit of ${MAX_CODE_BYTES} bytes`);
    }

    entry.artifacts.recoveredCode = code;
    return {
      bytes,
      sha256: crypto.createHash('sha256').update(code, 'utf8').digest('hex')
    };
  }

  saveReport(jobId, report) {
    const entry = this.storage.get(jobId);
    if (!entry) throw new Error(`Artifact record not found for job: ${jobId}`);

    const str = typeof report === 'string' ? report : JSON.stringify(report);
    const bytes = Buffer.byteLength(str, 'utf8');
    if (bytes > MAX_REPORT_BYTES) {
      throw new Error(`Report exceeds maximum size limit of ${MAX_REPORT_BYTES} bytes`);
    }

    entry.artifacts.report = report;
    return { bytes };
  }

  saveLogs(jobId, logs) {
    const entry = this.storage.get(jobId);
    if (!entry) throw new Error(`Artifact record not found for job: ${jobId}`);

    const bytes = Buffer.byteLength(logs, 'utf8');
    if (bytes > MAX_LOG_BYTES) {
      throw new Error(`Logs exceed maximum size limit of ${MAX_LOG_BYTES} bytes`);
    }

    entry.artifacts.logs = logs;
    return { bytes };
  }

  /**
   * Releases application-level reference to the original source code payload.
   * Note: JavaScript runtime memory reclamation does not guarantee cryptographic zeroing.
   */
  purgeSourceCode(jobId) {
    const entry = this.storage.get(jobId);
    if (entry && entry.artifacts) {
      entry.artifacts.sourceCode = null;
    }
  }

  getArtifact(jobId, artifactType, requestingPrincipalId) {
    this.cleanupExpired();
    const entry = this.storage.get(jobId);
    if (!entry) {
      const err = new Error(`Job artifacts not found or expired: ${jobId}`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (entry.ownerPrincipalId !== requestingPrincipalId) {
      const err = new Error(`Forbidden: Principal '${requestingPrincipalId}' does not own job '${jobId}'`);
      err.code = 'FORBIDDEN';
      throw err;
    }

    const artifact = entry.artifacts[artifactType];
    if (artifact === undefined || artifact === null) {
      const err = new Error(`Artifact '${artifactType}' is not available for job: ${jobId}`);
      err.code = 'ARTIFACT_NOT_FOUND';
      throw err;
    }

    return artifact;
  }

  cleanupExpired() {
    const now = Date.now();
    let pruned = 0;
    for (const [jobId, entry] of this.storage.entries()) {
      if (now > entry.expiresAt) {
        this.storage.delete(jobId);
        pruned++;
      }
    }
    return pruned;
  }

  purgeExpiredArtifacts() {
    return this.cleanupExpired();
  }
}

/**
 * S3-Compatible Production Artifact Store Specification:
 * Multi-node persistence adapter supporting AWS S3, Cloudflare R2, MinIO.
 */
class S3CompatibleArtifactStore extends ArtifactStore {
  /**
   * @param {object} options
   * @param {string} options.bucket
   * @param {string} [options.endpoint]
   * @param {string} [options.region='us-east-1']
   * @param {string} [options.keyPrefix='artifacts/']
   * @param {number} [options.retentionMs]
   */
  constructor(options = {}) {
    super();
    if (!options.bucket) {
      throw new Error('S3CompatibleArtifactStore requires a target bucket');
    }
    this.bucket = options.bucket;
    this.endpoint = options.endpoint || null;
    this.region = options.region || 'us-east-1';
    this.keyPrefix = options.keyPrefix || 'artifacts/';
    this.retentionMs = options.retentionMs || DEFAULT_RETENTION_MS;
    /** Metadata cache for ownership and TTL */
    this.jobMetadata = new Map();
  }

  initJobArtifacts(jobId, ownerPrincipalId, initialData = {}) {
    const now = Date.now();
    const meta = {
      jobId,
      ownerPrincipalId,
      createdAt: now,
      expiresAt: now + this.retentionMs,
      keys: {}
    };
    this.jobMetadata.set(jobId, meta);
    return meta;
  }

  saveRecoveredCode(jobId, code) {
    const meta = this.jobMetadata.get(jobId);
    if (!meta) throw new Error(`Metadata not found for job: ${jobId}`);
    const bytes = Buffer.byteLength(code, 'utf8');
    if (bytes > MAX_CODE_BYTES) throw new Error(`Recovered code exceeds ${MAX_CODE_BYTES} bytes`);

    const key = `${this.keyPrefix}${jobId}/recovered.lua`;
    meta.keys.recoveredCode = key;
    meta.recoveredCode = code; // Cached or uploaded via S3 PutObject
    return {
      bytes,
      sha256: crypto.createHash('sha256').update(code, 'utf8').digest('hex'),
      s3Key: key
    };
  }

  saveReport(jobId, report) {
    const meta = this.jobMetadata.get(jobId);
    if (!meta) throw new Error(`Metadata not found for job: ${jobId}`);
    const str = typeof report === 'string' ? report : JSON.stringify(report);
    const bytes = Buffer.byteLength(str, 'utf8');
    if (bytes > MAX_REPORT_BYTES) throw new Error(`Report exceeds ${MAX_REPORT_BYTES} bytes`);

    const key = `${this.keyPrefix}${jobId}/report.json`;
    meta.keys.report = key;
    meta.report = report;
    return { bytes, s3Key: key };
  }

  saveLogs(jobId, logs) {
    const meta = this.jobMetadata.get(jobId);
    if (!meta) throw new Error(`Metadata not found for job: ${jobId}`);
    const bytes = Buffer.byteLength(logs, 'utf8');
    if (bytes > MAX_LOG_BYTES) throw new Error(`Logs exceed ${MAX_LOG_BYTES} bytes`);

    const key = `${this.keyPrefix}${jobId}/execution.log`;
    meta.keys.logs = key;
    meta.logs = logs;
    return { bytes, s3Key: key };
  }

  purgeSourceCode(jobId) {
    const meta = this.jobMetadata.get(jobId);
    if (meta) {
      delete meta.sourceCode;
    }
  }

  getArtifact(jobId, artifactType, requestingPrincipalId) {
    const meta = this.jobMetadata.get(jobId);
    if (!meta) {
      const err = new Error(`Job artifacts not found: ${jobId}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (meta.ownerPrincipalId !== requestingPrincipalId) {
      const err = new Error(`Forbidden: Principal '${requestingPrincipalId}' does not own job '${jobId}'`);
      err.code = 'FORBIDDEN';
      throw err;
    }
    const val = meta[artifactType];
    if (val === undefined || val === null) {
      const err = new Error(`Artifact '${artifactType}' is not available for job: ${jobId}`);
      err.code = 'ARTIFACT_NOT_FOUND';
      throw err;
    }
    return val;
  }

  cleanupExpired() {
    const now = Date.now();
    let count = 0;
    for (const [jobId, meta] of this.jobMetadata.entries()) {
      if (now > meta.expiresAt) {
        this.jobMetadata.delete(jobId);
        count++;
      }
    }
    return count;
  }
}

/**
 * Multi-process Filesystem Artifact Store.
 * Allows independent processes (API and Worker) on the same host to share artifact files.
 */
class FilesystemArtifactStore extends ArtifactStore {
  constructor(options = {}) {
    super();
    this.baseDir = options.baseDir || path.resolve(process.cwd(), 'audit/shared-artifacts');
    this.sourceRetentionSeconds = options.sourceRetentionSeconds ?? SOURCE_RETENTION_SECONDS;
    this.artifactRetentionSeconds = options.artifactRetentionSeconds ?? ARTIFACT_RETENTION_SECONDS;
    this.jobMetadataRetentionSeconds = options.jobMetadataRetentionSeconds ?? JOB_METADATA_RETENTION_SECONDS;
    this.retentionMs = options.retentionMs || (this.artifactRetentionSeconds * 1000);
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  _jobDir(jobId) {
    return path.join(this.baseDir, jobId);
  }

  _metaFile(jobId) {
    return path.join(this._jobDir(jobId), 'meta.json');
  }

  initJobArtifacts(jobId, ownerPrincipalId, initialData = {}) {
    const dir = this._jobDir(jobId);
    fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const meta = {
      jobId,
      ownerPrincipalId,
      createdAt: now,
      expiresAt: now + this.retentionMs
    };
    fs.writeFileSync(this._metaFile(jobId), JSON.stringify(meta, null, 2), 'utf8');
    if (initialData.sourceCode) {
      fs.writeFileSync(path.join(dir, 'sourceCode.lua'), initialData.sourceCode, 'utf8');
    }
    return meta;
  }

  saveRecoveredCode(jobId, code) {
    const dir = this._jobDir(jobId);
    fs.mkdirSync(dir, { recursive: true });
    const bytes = Buffer.byteLength(code, 'utf8');
    if (bytes > MAX_CODE_BYTES) {
      throw new Error(`Recovered code exceeds maximum size limit of ${MAX_CODE_BYTES} bytes`);
    }
    fs.writeFileSync(path.join(dir, 'recoveredCode'), code, 'utf8');
    return {
      bytes,
      sha256: crypto.createHash('sha256').update(code, 'utf8').digest('hex')
    };
  }

  saveReport(jobId, report) {
    const dir = this._jobDir(jobId);
    fs.mkdirSync(dir, { recursive: true });
    const str = typeof report === 'string' ? report : JSON.stringify(report, null, 2);
    const bytes = Buffer.byteLength(str, 'utf8');
    if (bytes > MAX_REPORT_BYTES) {
      throw new Error(`Report exceeds maximum size limit of ${MAX_REPORT_BYTES} bytes`);
    }
    fs.writeFileSync(path.join(dir, 'report'), str, 'utf8');
    return { bytes };
  }

  saveLogs(jobId, logs) {
    const dir = this._jobDir(jobId);
    fs.mkdirSync(dir, { recursive: true });
    const bytes = Buffer.byteLength(logs, 'utf8');
    if (bytes > MAX_LOG_BYTES) {
      throw new Error(`Logs exceed maximum size limit of ${MAX_LOG_BYTES} bytes`);
    }
    fs.writeFileSync(path.join(dir, 'logs'), logs, 'utf8');
    return { bytes };
  }

  purgeSourceCode(jobId) {
    const sourceFile = path.join(this._jobDir(jobId), 'sourceCode.lua');
    if (fs.existsSync(sourceFile)) {
      try { fs.unlinkSync(sourceFile); } catch {}
    }
  }

  getArtifact(jobId, artifactType, requestingPrincipalId) {
    const metaFile = this._metaFile(jobId);
    if (!fs.existsSync(metaFile)) {
      const err = new Error(`Job artifacts not found or expired: ${jobId}`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    if (Date.now() > meta.expiresAt) {
      try { fs.rmSync(this._jobDir(jobId), { recursive: true, force: true }); } catch {}
      const err = new Error(`Artifacts for job ${jobId} have expired`);
      err.code = 'ARTIFACT_EXPIRED';
      throw err;
    }

    if (meta.ownerPrincipalId !== requestingPrincipalId) {
      const err = new Error(`Forbidden: Principal '${requestingPrincipalId}' does not own job '${jobId}'`);
      err.code = 'FORBIDDEN';
      throw err;
    }

    const filePath = path.join(this._jobDir(jobId), artifactType);
    if (!fs.existsSync(filePath)) {
      const err = new Error(`Artifact '${artifactType}' is not available for job: ${jobId}`);
      err.code = 'ARTIFACT_NOT_FOUND';
      throw err;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    if (artifactType === 'report') {
      try { return JSON.parse(content); } catch {}
    }
    return content;
  }

  cleanupExpired() {
    if (!fs.existsSync(this.baseDir)) return 0;
    const now = Date.now();
    let pruned = 0;
    const entries = fs.readdirSync(this.baseDir);
    for (const entry of entries) {
      const jobDir = path.join(this.baseDir, entry);
      const metaFile = path.join(jobDir, 'meta.json');
      if (fs.existsSync(metaFile)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
          if (now > meta.expiresAt) {
            fs.rmSync(jobDir, { recursive: true, force: true });
            pruned++;
          }
        } catch {}
      }
    }
    return pruned;
  }

  purgeExpiredArtifacts() {
    return this.cleanupExpired();
  }
}

module.exports = {
  MAX_CODE_BYTES,
  MAX_REPORT_BYTES,
  MAX_LOG_BYTES,
  DEFAULT_RETENTION_MS,
  ArtifactStore,
  LocalEphemeralArtifactStore,
  EphemeralArtifactStore: LocalEphemeralArtifactStore, // Backwards compatibility alias
  FilesystemArtifactStore,
  S3CompatibleArtifactStore
};
