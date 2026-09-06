/**
 * @valax/gateway:
 * Hosted gateway, rate limiter, artifact store, and metrics exports.
 */

const { RateLimiter } = require('./rate-limiter');
const {
  ArtifactStore,
  LocalEphemeralArtifactStore,
  EphemeralArtifactStore,
  S3CompatibleArtifactStore,
  MAX_CODE_BYTES,
  MAX_REPORT_BYTES,
  MAX_LOG_BYTES,
  DEFAULT_RETENTION_MS
} = require('./artifact-store');
const { MetricsCollector } = require('./metrics');
const { RecoveryGateway } = require('./recovery-gateway');

module.exports = {
  RateLimiter,
  ArtifactStore,
  LocalEphemeralArtifactStore,
  EphemeralArtifactStore,
  S3CompatibleArtifactStore,
  MAX_CODE_BYTES,
  MAX_REPORT_BYTES,
  MAX_LOG_BYTES,
  DEFAULT_RETENTION_MS,
  MetricsCollector,
  RecoveryGateway
};
