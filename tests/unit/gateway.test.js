const assert = require('assert');
const { describe, test } = require('../test-framework');
const { RateLimiter, EphemeralArtifactStore, MetricsCollector, RecoveryGateway } = require('../../packages/gateway/src');

function runGatewayTests() {
  describe('Gateway, Rate Limiting, Artifact Store, and Metrics Tests', () => {

    test('1. RateLimiter enforces burst limit', () => {
      const limiter = new RateLimiter({
        windowMs: 60000,
        maxRequestsPerWindow: 5,
        burstLimit: 3
      });

      const p = 'user-test-rl';
      assert.strictEqual(limiter.checkLimit(p).allowed, true);
      assert.strictEqual(limiter.checkLimit(p).allowed, true);
      assert.strictEqual(limiter.checkLimit(p).allowed, true);

      const burstExceeded = limiter.checkLimit(p);
      assert.strictEqual(burstExceeded.allowed, false);
      assert.strictEqual(burstExceeded.reason, 'BURST_LIMIT_EXCEEDED');
    });

    test('2. RateLimiter limits concurrent jobs per principal', () => {
      const limiter = new RateLimiter({ maxConcurrentPerPrincipal: 2 });
      const p = 'user-conc';

      const s1 = limiter.acquireConcurrency(p);
      assert.strictEqual(s1.acquired, true);
      assert.strictEqual(s1.activeCount, 1);

      const s2 = limiter.acquireConcurrency(p);
      assert.strictEqual(s2.acquired, true);
      assert.strictEqual(s2.activeCount, 2);

      const s3 = limiter.acquireConcurrency(p);
      assert.strictEqual(s3.acquired, false);

      limiter.releaseConcurrency(p);
      const s4 = limiter.acquireConcurrency(p);
      assert.strictEqual(s4.acquired, true);
    });

    test('3. EphemeralArtifactStore enforces authorization and immediate source purging', () => {
      const store = new EphemeralArtifactStore();
      const jobId = 'art-job-1';
      const owner = 'principal-alpha';
      const attacker = 'principal-attacker';

      store.initJobArtifacts(jobId, owner, { sourceCode: 'print("secret")' });
      store.saveRecoveredCode(jobId, 'print("recovered")');
      store.saveReport(jobId, { tier: 'L5-W' });

      // Authorized access
      const code = store.getArtifact(jobId, 'recoveredCode', owner);
      assert.strictEqual(code, 'print("recovered")');

      // Unauthorized access denied
      assert.throws(() => {
        store.getArtifact(jobId, 'recoveredCode', attacker);
      }, (err) => err.code === 'FORBIDDEN');

      // Source code purged
      store.purgeSourceCode(jobId);
      assert.throws(() => {
        store.getArtifact(jobId, 'sourceCode', owner);
      }, (err) => err.code === 'ARTIFACT_NOT_FOUND');
    });

    test('4. EphemeralArtifactStore rejects oversized artifacts', () => {
      const store = new EphemeralArtifactStore();
      const jobId = 'art-job-2';
      store.initJobArtifacts(jobId, 'owner');

      const hugeCode = 'x'.repeat(6 * 1024 * 1024); // 6 MB exceeds 5 MB cap
      assert.throws(() => {
        store.saveRecoveredCode(jobId, hugeCode);
      }, /maximum size limit/);
    });

    test('5. MetricsCollector accurately records stats without leaking sensitive payload data', () => {
      const metrics = new MetricsCollector();
      metrics.inc('jobs_submitted_total');
      metrics.inc('jobs_completed_total');
      metrics.recordJobDuration(120);
      metrics.recordAdmission('L5-W', true);

      const snapshot = metrics.getSnapshot();
      assert.strictEqual(snapshot.counters.jobs_submitted_total, 1);
      assert.strictEqual(snapshot.counters.admissions_l5w_total, 1);
      assert.strictEqual(snapshot.timings.avgDurationMs, 120);

      // Verify snapshot does NOT contain any code strings or user data
      const jsonStr = JSON.stringify(snapshot);
      assert.strictEqual(jsonStr.includes('print'), false);
      assert.strictEqual(jsonStr.includes('secret'), false);
    });

    test('6. Gateway health checks (/livez, /readyz) verify core baseline', () => {
      const gateway = new RecoveryGateway();
      const liveness = gateway.getLiveness();
      assert.strictEqual(liveness.status, 'OK');

      const readiness = gateway.getReadiness();
      assert.strictEqual(readiness.ready, true);
      assert.strictEqual(readiness.coreBaseline.verified, true);
      assert.strictEqual(readiness.coreBaseline.totalChecked, 51);
    });

  });
}

module.exports = { runGatewayTests };

if (require.main === module) {
  const { printSummary } = require('../test-framework');
  runGatewayTests();
  printSummary();
}
