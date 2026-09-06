const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, test } = require('../test-framework');
const { RecoveryGateway } = require('../../packages/gateway/src');
const { ContainerRunner, CoreBaselineGuard, WorkerStatus, WorkerExecutor } = require('../../packages/worker/src');

function runPhase2SecurityTests() {
  describe('Phase 2 Hosted Isolation, Worker Security, & E2E Verification', () => {

    const gateway = new RecoveryGateway();
    const runner = new ContainerRunner();
    const guard = new CoreBaselineGuard();

    // 1. Container Security Arguments Profile (Static configuration verification)
    test('1. [STATIC_CONFIGURATION_TEST] CONTAINER_PROFILE_CONFIGURATION_PASS: CLI security arguments profile', () => {
      const args = runner.getSecurityArgs();
      assert.ok(args.includes('--network') && args[args.indexOf('--network') + 1] === 'none', 'Missing --network none');
      assert.ok(args.includes('--read-only'), 'Missing --read-only');
      assert.ok(args.includes('--user') && args[args.indexOf('--user') + 1] === '1000:1000', 'Missing --user 1000:1000');
      assert.ok(args.includes('--cap-drop') && args[args.indexOf('--cap-drop') + 1] === 'ALL', 'Missing --cap-drop ALL');
      assert.ok(args.includes('--security-opt') && args[args.indexOf('--security-opt') + 1] === 'no-new-privileges:true', 'Missing no-new-privileges');
      assert.ok(args.includes('--memory') && args[args.indexOf('--memory') + 1] === '512m', 'Missing memory limit');
      assert.ok(args.includes('--pids-limit') && args[args.indexOf('--pids-limit') + 1] === '128', 'Missing pids limit');
      assert.ok(args.some(a => a.includes('/work:rw,noexec,nosuid')), 'Missing /work tmpfs');
      assert.ok(args.some(a => a.includes('/tmp:rw,noexec,nosuid')), 'Missing /tmp tmpfs');
      assert.strictEqual(args.some(a => a === '-v' || a === '--volume'), false, 'Forbidden host volume mount found');
    });

    // 2. Core Baseline Guard Integrity
    test('2. [STATIC_CONFIGURATION_TEST] Core baseline guard verified all 51 files match frozen hashes', () => {
      const check = guard.verify(path.resolve(__dirname, '../../'));
      assert.strictEqual(check.verified, true);
      assert.strictEqual(check.totalChecked, 51);
    });

    // 3. E2E Positive Recovery (minimal_print -> L5-W)
    test('3. [IN_PROCESS_E2E] minimal_print admitted to L5-W with source release', () => {
      const principal = 'test-client-1';
      const fixturePath = path.resolve(__dirname, '../fixtures/wearedevs/minimal_print/protected.lua');
      const source = fs.readFileSync(fixturePath, 'utf8');

      const sub = gateway.submitJobSync({
        principalId: principal,
        source,
        filename: 'minimal_print.lua'
      });

      assert.strictEqual(sub.state, 'QUEUED');

      // Worker processes next job
      const result = gateway.processNextJobSync('worker-node-1');
      assert.ok(result !== null);
      assert.strictEqual(result.status, WorkerStatus.COMPLETED);
      assert.strictEqual(result.admission.isL5WEligible, true);
      assert.strictEqual(result.admission.admittedTier, 'L5-W');

      // Retrieve status and recovered code artifact
      const jobStatus = gateway.getJob(sub.jobId, principal);
      assert.strictEqual(jobStatus.state, 'COMPLETED');
      assert.strictEqual(jobStatus.result.admission.isL5WEligible, true);

      const recoveredCode = gateway.getArtifact(sub.jobId, 'recoveredCode', principal);
      assert.ok(recoveredCode.includes('print'));

      // Verify source code was purged
      assert.throws(() => {
        gateway.getArtifact(sub.jobId, 'sourceCode', principal);
      }, (err) => err.code === 'ARTIFACT_NOT_FOUND');
    });

    // 4. [IN_PROCESS_E2E] ByIdiotSandWich Sample (Must be L4, NOT L5-W)
    test('4. [IN_PROCESS_E2E] ByIdiotSandWich: admitted to L4, denied L5-W as expected', () => {
      const fixturePath = path.resolve(__dirname, '../fixtures/ByIdiotSandWich.lua');
      if (fs.existsSync(fixturePath)) {
        const source = fs.readFileSync(fixturePath, 'utf8');
        const principal = 'analyst-team';

        const sub = gateway.submitJobSync({
          principalId: principal,
          source,
          filename: 'ByIdiotSandWich.lua'
        });

        const result = gateway.processNextJobSync('worker-node-2');
        assert.strictEqual(result.status, WorkerStatus.COMPLETED);
        assert.strictEqual(result.admission.isL5WEligible, false, 'ByIdiotSandWich must NOT be admitted to L5-W');
        assert.strictEqual(result.admission.admittedTier, 'L4', 'ByIdiotSandWich must be admitted as L4');
      }
    });

    // 5. [IN_PROCESS_E2E] Adversarial Negative Sample (Must NOT be L5-W)
    test('5. [IN_PROCESS_E2E] Adversarial negative sample safely denied L5-W', () => {
      const negFixture = path.resolve(__dirname, '../fixtures/adversarial/adversarial_negative_1.lua');
      if (fs.existsSync(negFixture)) {
        const source = fs.readFileSync(negFixture, 'utf8');
        const principal = 'security-audit';

        const sub = gateway.submitJobSync({
          principalId: principal,
          source,
          filename: 'adversarial_neg_1.lua'
        });

        const result = gateway.processNextJobSync('worker-node-3');
        assert.strictEqual(result.status, WorkerStatus.COMPLETED);
        assert.strictEqual(result.admission.isL5WEligible, false, 'Adversarial negative must NOT be L5-W');
      }
    });

    // 6. [UNIT_TEST] Security Violation - Input SHA256 Tampering
    test('6. [UNIT_TEST] Tampered input payload rejected with INPUT_INTEGRITY_FAILURE', () => {
      const executor = new WorkerExecutor();
      const badReq = {
        schemaVersion: '1',
        jobId: 'tampered-job',
        input: {
          filename: 'hack.lua',
          sha256: '0000000000000000000000000000000000000000000000000000000000000000',
          source: 'print("legit code")'
        }
      };

      const resp = executor.executeJobSync(badReq);
      assert.strictEqual(resp.status, WorkerStatus.INPUT_INTEGRITY_FAILURE);
      assert.strictEqual(resp.error.code, 'INPUT_SHA256_MISMATCH');
    });

    // 7. [UNIT_TEST] Security Violation - Cross-Principal Data Exfiltration Attempt
    test('7. [UNIT_TEST] Cross-principal artifact access blocked with FORBIDDEN', () => {
      const sub = gateway.submitJobSync({
        principalId: 'victim-corp',
        source: 'print("corporate secret")',
        filename: 'secret.lua'
      });
      gateway.processNextJobSync('worker-node-1');

      assert.throws(() => {
        gateway.getArtifact(sub.jobId, 'recoveredCode', 'unauthorized-hacker');
      }, (err) => err.code === 'FORBIDDEN');
    });

  });
}

module.exports = { runPhase2SecurityTests };

if (require.main === module) {
  const { printSummary } = require('../test-framework');
  runPhase2SecurityTests();
  printSummary();
}
