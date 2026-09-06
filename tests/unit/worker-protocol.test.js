const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { describe, test } = require('../test-framework');
const { WorkerProtocol, WorkerStatus, PROTOCOL_VERSION, CoreBaselineGuard } = require('../../packages/worker/src');

function runWorkerProtocolTests() {
  describe('Worker Protocol & Baseline Guard Tests', () => {

    test('1. parseRequest succeeds for valid request', () => {
      const rawSource = 'print("hello world")';
      const sha256 = crypto.createHash('sha256').update(rawSource).digest('hex');

      const req = {
        schemaVersion: PROTOCOL_VERSION,
        jobId: 'job-test-1',
        input: {
          filename: 'test.lua',
          sha256,
          source: rawSource
        }
      };

      const res = WorkerProtocol.parseRequest(req);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.normalizedRequest.jobId, 'job-test-1');
      assert.strictEqual(res.normalizedRequest.input.sha256, sha256);
      assert.strictEqual(res.normalizedRequest.limits.timeoutMs, 30000);
    });

    test('2. parseRequest rejects unsupported schemaVersion', () => {
      const req = {
        schemaVersion: '999',
        jobId: 'job-test-2',
        input: { sha256: 'a'.repeat(64) }
      };
      const res = WorkerProtocol.parseRequest(req);
      assert.strictEqual(res.valid, false);
      assert.ok(res.error.includes('Unsupported schemaVersion'));
    });

    test('3. parseRequest validates sha256 format', () => {
      const req = {
        schemaVersion: PROTOCOL_VERSION,
        jobId: 'job-test-3',
        input: { sha256: 'invalid-hash' }
      };
      const res = WorkerProtocol.parseRequest(req);
      assert.strictEqual(res.valid, false);
      assert.ok(res.error.includes('64-character'));
    });

    test('4. verifyInputIntegrity correctly verifies hashes', () => {
      const text = 'local x = 123';
      const validHash = crypto.createHash('sha256').update(text).digest('hex');
      assert.strictEqual(WorkerProtocol.verifyInputIntegrity(text, validHash), true);
      assert.strictEqual(WorkerProtocol.verifyInputIntegrity(text, 'badhash'.padEnd(64, '0')), false);
    });

    test('5. createResponse generates standardized response', () => {
      const resp = WorkerProtocol.createResponse({
        jobId: 'job-test-5',
        status: WorkerStatus.COMPLETED,
        admission: { admittedTier: 'L5-W', isL5WEligible: true },
        metrics: { durationMs: 150 },
        artifacts: { recoveredCodeSha256: 'hash123', recoveredCodeBytes: 42 }
      });

      assert.strictEqual(resp.schemaVersion, PROTOCOL_VERSION);
      assert.strictEqual(resp.status, WorkerStatus.COMPLETED);
      assert.strictEqual(resp.admission.admittedTier, 'L5-W');
      assert.strictEqual(resp.admission.isL5WEligible, true);
      assert.strictEqual(resp.metrics.durationMs, 150);
      assert.strictEqual(resp.artifacts.recoveredCodeBytes, 42);
    });

    test('6. CoreBaselineGuard verified all frozen core files against audit', () => {
      const guard = new CoreBaselineGuard();
      const result = guard.verify(path.resolve(__dirname, '../../'));
      assert.strictEqual(result.verified, true, `Core baseline check failed: ${JSON.stringify(result.mismatches)}`);
      assert.ok(result.baselineTag.includes('CORE_BASELINE_0.1.0-beta.1'));
      assert.strictEqual(result.totalChecked, 51);
      assert.strictEqual(result.mismatches.length, 0);
    });

  });
}

module.exports = { runWorkerProtocolTests };

if (require.main === module) {
  const { printSummary } = require('../test-framework');
  runWorkerProtocolTests();
  printSummary();
}
