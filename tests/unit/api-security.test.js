/**
 * Phase 3 API Security, Authorization, and Contract Unit Test Suite.
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { ProductApiServer, ApiErrorCode, DevelopmentAuthProvider, isValidProductTransition, ProductJobState } = require('../../packages/api/src');
const { RecoveryGateway } = require('../../packages/gateway/src');
const { RedactingLogger } = require('../../packages/api/src/logger');

// Helper to make local HTTP requests to ProductApiServer
function request(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const addr = server.server.address();
    const reqOpts = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: options.path,
      method: options.method || 'GET',
      agent: false,
      headers: {
        Connection: 'close',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOpts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
          json
        });
      });
    });

    req.on('error', reject);

    if (body) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      req.setHeader('Content-Length', Buffer.byteLength(payload, 'utf8'));
      if (!req.getHeader('Content-Type')) {
        req.setHeader('Content-Type', 'application/json');
      }
      req.write(payload);
    }
    req.end();
  });
}

let passed = 0;
let failed = 0;
const testResults = [];

async function runStep(name, fn) {
  try {
    const start = Date.now();
    await fn();
    const durationMs = Date.now() - start;
    passed++;
    testResults.push({ name, status: 'PASS', durationMs });
    console.log(`  [PASS] ${name} (${durationMs}ms)`);
  } catch (err) {
    failed++;
    testResults.push({ name, status: 'FAIL', error: err.message });
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    throw err;
  }
}

async function runApiSecurityTests() {
  console.log('\n=== Phase 3 Round 1 — Product API, Authorization & Security Enforcement ===');
  let gateway;
  let logger;
  let apiServer;
  const testPort = 39100 + Math.floor(Math.random() * 500);
  let createdJobId = null;
  const testSource = 'print("Hello from Phase 3 Round 1 Test")';

  try {
    await runStep('0. Setup Test Environment', async () => {
      gateway = new RecoveryGateway();
      logger = new RedactingLogger({ captureLogs: true });
      apiServer = new ProductApiServer({
        gateway,
        logger,
        maxSourceBytes: 1024 * 1024, // 1 MB for testing
        maxConcurrentJobs: 3,
        maxJobsPerDay: 50
      });

      await new Promise(resolve => apiServer.listen(testPort, resolve));
    });

    // 1. Health Endpoints
    await runStep('1. Health endpoints (/health/live, /health/ready)', async () => {
      const liveRes = await request(apiServer, { path: '/health/live' });
      assert.strictEqual(liveRes.statusCode, 200);
      assert.strictEqual(liveRes.json.status, 'OK');
      assert.ok(liveRes.headers['content-security-policy']);
      assert.strictEqual(liveRes.headers['x-content-type-options'], 'nosniff');

      const readyRes = await request(apiServer, { path: '/health/ready' });
      assert.strictEqual(readyRes.statusCode, 200);
      assert.strictEqual(readyRes.json.ready, true);
    });

    // 2. Authentication Rejection
    await runStep('2. Unauthenticated request rejected with 401 UNAUTHORIZED', async () => {
      const res = await request(apiServer, {
        path: '/api/v1/recoveries',
        method: 'POST'
      }, { filename: 'test.lua', source: 'print(1)' });

      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.json.error.code, ApiErrorCode.UNAUTHORIZED);
    });

    // 3. Production Hard Rejection of DevelopmentAuthProvider
    await runStep('3. DevelopmentAuthProvider strictly rejected in production NODE_ENV', () => {
      assert.throws(() => {
        new DevelopmentAuthProvider({ nodeEnv: 'production' });
      }, /cannot be initialized in production/);
    });

    // 4. Input Filename Sanitization & Path Traversal Rejection
    await runStep('4. Dangerous filename traversal patterns rejected with 400 INVALID_FILE', async () => {
      const maliciousFilenames = [
        '../../evil.lua',
        '..\\..\\evil.lua',
        'C:\\Windows\\System32\\cmd.lua',
        '/etc/passwd',
        'file:///etc/passwd',
        'evil\0script.lua',
        'unsupported.exe',
        'bad.py'
      ];

      for (const badName of maliciousFilenames) {
        const res = await request(apiServer, {
          path: '/api/v1/recoveries',
          method: 'POST',
          headers: { 'X-Development-Principal': 'analyst-1' }
        }, { filename: badName, source: 'print("traversal")' });

        assert.strictEqual(res.statusCode, 400, `Failed to reject filename: ${badName}`);
        assert.strictEqual(res.json.error.code, ApiErrorCode.INVALID_FILE);
      }
    });

    // 5. NUL Bytes in Source Rejected
    await runStep('5. Source payload with NUL bytes rejected with 400 INVALID_FILE', async () => {
      const res = await request(apiServer, {
        path: '/api/v1/recoveries',
        method: 'POST',
        headers: { 'X-Development-Principal': 'analyst-1' }
      }, { filename: 'nul.lua', source: 'local a = "\0secret"' });

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json.error.code, ApiErrorCode.INVALID_FILE);
    });

    // 6. Valid Submission Returns Asynchronous 201 Created (QUEUED)
    await runStep('6. Valid recovery upload creates QUEUED job with stable schema (201 Created)', async () => {
      const res = await request(apiServer, {
        path: '/api/v1/recoveries',
        method: 'POST',
        headers: {
          'X-Development-Principal': 'analyst-1',
          'Idempotency-Key': 'idemp-key-test-1'
        }
      }, { filename: 'sample.lua', source: testSource });

      assert.strictEqual(res.statusCode, 201);
      assert.ok(res.json.jobId);
      assert.strictEqual(res.json.state, ProductJobState.QUEUED);
      assert.strictEqual(res.json.links.self, `/api/v1/recoveries/${res.json.jobId}`);
      createdJobId = res.json.jobId;
    });

    // 7. Idempotency Invariant: Same Tuple Returns Duplicate Job Without Re-Enqueueing
    await runStep('7. Exact same idempotency key returns existing job without duplication', async () => {
      const res = await request(apiServer, {
        path: '/api/v1/recoveries',
        method: 'POST',
        headers: {
          'X-Development-Principal': 'analyst-1',
          'Idempotency-Key': 'idemp-key-test-1'
        }
      }, { filename: 'sample.lua', source: testSource });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.jobId, createdJobId);
      assert.strictEqual(res.json.isDuplicate, true);
    });

    // 8. Idempotency Conflict: Same Key with Different Content Rejects with 409
    await runStep('8. Reused idempotency key with conflicting content rejected with 409 IDEMPOTENCY_CONFLICT', async () => {
      const res = await request(apiServer, {
        path: '/api/v1/recoveries',
        method: 'POST',
        headers: {
          'X-Development-Principal': 'analyst-1',
          'Idempotency-Key': 'idemp-key-test-1'
        }
      }, { filename: 'sample.lua', source: 'print("different content!")' });

      assert.strictEqual(res.statusCode, 409);
      assert.strictEqual(res.json.error.code, ApiErrorCode.IDEMPOTENCY_CONFLICT);
    });

    // 9. Cross-User Ownership Isolation: User B Denied Access to User A's Job
    await runStep('9. Cross-user job access strictly denied with 403 FORBIDDEN', async () => {
      // User B attempts to read User A's job
      const getRes = await request(apiServer, {
        path: `/api/v1/recoveries/${createdJobId}`,
        headers: { 'X-Development-Principal': 'unauthorized-user-2' }
      });
      assert.strictEqual(getRes.statusCode, 403);
      assert.strictEqual(getRes.json.error.code, ApiErrorCode.FORBIDDEN);

      // User B attempts to delete/cancel User A's job
      const delRes = await request(apiServer, {
        path: `/api/v1/recoveries/${createdJobId}`,
        method: 'DELETE',
        headers: { 'X-Development-Principal': 'unauthorized-user-2' }
      });
      assert.strictEqual(delRes.statusCode, 403);
      assert.strictEqual(delRes.json.error.code, ApiErrorCode.FORBIDDEN);

      // User B attempts to access artifacts
      const artRes = await request(apiServer, {
        path: `/api/v1/recoveries/${createdJobId}/artifacts`,
        headers: { 'X-Development-Principal': 'unauthorized-user-2' }
      });
      assert.strictEqual(artRes.statusCode, 403);
      assert.strictEqual(artRes.json.error.code, ApiErrorCode.FORBIDDEN);
    });

    // 10. Server Identity Wins Over Forged Parameters
    await runStep('10. Client cannot forge principal ID in body or query parameters', async () => {
      const res = await request(apiServer, {
        path: '/api/v1/recoveries?principalId=admin-principal',
        method: 'POST',
        headers: { 'X-Development-Principal': 'regular-user' }
      }, {
        filename: 'forged.lua',
        source: 'print("forged")',
        ownerPrincipalId: 'admin-principal',
        principalId: 'admin-principal'
      });

      assert.strictEqual(res.statusCode, 201);
      const jId = res.json.jobId;

      // Ensure 'regular-user' can access it, but 'admin-principal' CANNOT access it
      const legitRes = await request(apiServer, {
        path: `/api/v1/recoveries/${jId}`,
        headers: { 'X-Development-Principal': 'regular-user' }
      });
      assert.strictEqual(legitRes.statusCode, 200);

      const hackerRes = await request(apiServer, {
        path: `/api/v1/recoveries/${jId}`,
        headers: { 'X-Development-Principal': 'admin-principal' }
      });
      assert.strictEqual(hackerRes.statusCode, 403);
    });

    // 11. State Machine: Terminal States Cannot Transition to Active States
    await runStep('11. Canonical Product FSM enforces terminal irreversibility', () => {
      assert.strictEqual(isValidProductTransition(ProductJobState.SUCCEEDED, ProductJobState.RUNNING), false);
      assert.strictEqual(isValidProductTransition(ProductJobState.FAILED, ProductJobState.RUNNING), false);
      assert.strictEqual(isValidProductTransition(ProductJobState.TIMED_OUT, ProductJobState.RUNNING), false);
      assert.strictEqual(isValidProductTransition(ProductJobState.CANCELLED, ProductJobState.RUNNING), false);
      assert.strictEqual(isValidProductTransition(ProductJobState.QUEUED, ProductJobState.RUNNING), true);
      assert.strictEqual(isValidProductTransition(ProductJobState.RUNNING, ProductJobState.SUCCEEDED), true);
    });

    // 12. Cancellation of Active Job Succeeds
    await runStep('12. Owner cancellation of active job succeeds', async () => {
      const delRes = await request(apiServer, {
        path: `/api/v1/recoveries/${createdJobId}`,
        method: 'DELETE',
        headers: { 'X-Development-Principal': 'analyst-1' }
      });

      assert.strictEqual(delRes.statusCode, 200);
      assert.strictEqual(delRes.json.state, ProductJobState.CANCELLED);

      // Verify job is now CANCELLED
      const getRes = await request(apiServer, {
        path: `/api/v1/recoveries/${createdJobId}`,
        headers: { 'X-Development-Principal': 'analyst-1' }
      });
      assert.strictEqual(getRes.statusCode, 200);
      assert.strictEqual(getRes.json.state, ProductJobState.CANCELLED);
    });

    // 13. Terminal Job Cancellation Rejected with 409 JOB_NOT_CANCELLABLE
    await runStep('13. Cancellation of terminal job rejected with 409 JOB_NOT_CANCELLABLE', async () => {
      const delRes = await request(apiServer, {
        path: `/api/v1/recoveries/${createdJobId}`,
        method: 'DELETE',
        headers: { 'X-Development-Principal': 'analyst-1' }
      });

      assert.strictEqual(delRes.statusCode, 409);
      assert.strictEqual(delRes.json.error.code, ApiErrorCode.JOB_NOT_CANCELLABLE);
    });

    // 14. Artifact Authorization & Guessed Artifact Rejection
    await runStep('14. Guessed or non-existent artifact IDs return 404 ARTIFACT_NOT_FOUND', async () => {
      const res = await request(apiServer, {
        path: `/api/v1/recoveries/${createdJobId}/artifacts/invalid-secret-key`,
        headers: { 'X-Development-Principal': 'analyst-1' }
      });

      assert.strictEqual(res.statusCode, 404);
      assert.strictEqual(res.json.error.code, ApiErrorCode.ARTIFACT_NOT_FOUND);
    });

    // 15. Source Secret Log Canary Test: Zero Source Leaks
    await runStep('15. [SECURITY] Source secret canary test confirms zero occurrences in captured logs', async () => {
      const secretCanary = `VALAX_SOURCE_SECRET_CANARY_${crypto.randomBytes(16).toString('hex')}`;
      const canarySource = `-- Confidential Proprietary Code\nlocal token = "${secretCanary}"\nprint(token)`;

      logger.clearCapturedLogs();

      const subRes = await request(apiServer, {
        path: '/api/v1/recoveries',
        method: 'POST',
        headers: {
          'X-Development-Principal': 'canary-principal',
          'Authorization': 'Bearer dev-canary-principal'
        }
      }, { filename: 'canary.lua', source: canarySource });

      assert.strictEqual(subRes.statusCode, 201);

      // Retrieve all captured log text
      const captured = logger.getCapturedLogs();

      // STRICT INVARIANT: Canary string MUST NOT appear in logs!
      assert.strictEqual(
        captured.includes(secretCanary),
        false,
        'SECURITY FAILURE: Source secret canary was leaked into server logs!'
      );

      // STRICT INVARIANT: Authorization header must not be logged
      assert.strictEqual(
        captured.includes('Bearer dev-canary-principal'),
        false,
        'SECURITY FAILURE: Authorization token leaked into server logs!'
      );
    });

  } finally {
    if (apiServer) {
      await new Promise(resolve => apiServer.close(resolve));
    }
  }

  const auditDir = path.resolve(__dirname, '../../audit');
  if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });

  fs.writeFileSync(
    path.join(auditDir, 'phase3-api-security.json'),
    JSON.stringify({
      testSuite: 'API_SECURITY_AND_AUTHORIZATION',
      timestamp: new Date().toISOString(),
      tests: testResults,
      securityInvariants: {
        devAuthRejectedInProduction: true,
        pathTraversalBlocked: true,
        nulByteInjectionBlocked: true,
        principalIsolationEnforced: true,
        sourceCanaryZeroLeakage: true,
        authHeaderZeroLeakage: true,
        idempotencyEnforced: true,
        canonicalFsmIrreversibility: true
      },
      summary: {
        total: passed + failed,
        passed,
        failed,
        verdict: failed === 0 ? 'API_SECURITY_PASS' : 'API_SECURITY_FAIL'
      }
    }, null, 2),
    'utf8'
  );

  fs.writeFileSync(
    path.join(auditDir, 'phase3-authz-matrix.json'),
    JSON.stringify({
      providerIndependentPrincipalModel: true,
      timestamp: new Date().toISOString(),
      matrix: [
        { scenario: 'Anonymous Request', expectedStatus: 401, verified: true },
        { scenario: 'Owner Request', expectedStatus: 200, verified: true },
        { scenario: 'Cross-Principal Access (Job Status)', expectedStatus: 403, verified: true },
        { scenario: 'Cross-Principal Access (Artifact Download)', expectedStatus: 403, verified: true },
        { scenario: 'Cross-Principal Access (Job Cancellation)', expectedStatus: 403, verified: true },
        { scenario: 'Owner Job Cancellation (Active)', expectedStatus: 200, verified: true },
        { scenario: 'Owner Job Cancellation (Terminal)', expectedStatus: 409, verified: true },
        { scenario: 'Client Body Principal Spoofing Override', expectedStatus: 201, principalOverridden: true, verified: true }
      ],
      verdict: 'AUTHORIZATION_MATRIX_VERIFIED'
    }, null, 2),
    'utf8'
  );

  console.log('\n========================================');
  console.log(`Test Results: ${passed}/${passed + failed} Passed (${failed} Failed)`);
  if (failed === 0) {
    console.log('ALL API SECURITY TESTS PASSED [PASS]');
  }
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  runApiSecurityTests().catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
  });
}

module.exports = { runApiSecurityTests };
