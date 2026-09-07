/**
 * Phase 3 PRODUCT_CONTRACT_E2E:
 * In-process end-to-end contract validation covering HTTP client -> Product API -> Gateway -> ArtifactStore.
 * Accurately labeled: PRODUCT_CONTRACT_E2E (In-Process Mock Execution).
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { ProductApiServer, ProductJobState } = require('../../packages/api/src');
const { RecoveryGateway } = require('../../packages/gateway/src');

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
const contractResults = [];

async function runStep(name, fn) {
  try {
    const start = Date.now();
    await fn();
    const durationMs = Date.now() - start;
    passed++;
    contractResults.push({ name, status: 'PASS', durationMs });
    console.log(`  [PASS] ${name} (${durationMs}ms)`);
  } catch (err) {
    failed++;
    contractResults.push({ name, status: 'FAIL', error: err.message });
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    throw err;
  }
}

async function runProductContractE2ETests() {
  console.log('\n=== Phase 3 Round 1 — [PRODUCT_CONTRACT_E2E] End-to-End Product API Contract ===');
  let gateway;
  let apiServer;
  const testPort = 39600 + Math.floor(Math.random() * 300);
  const principal = 'contract-analyst-1';
  let jobId = null;

  try {
    await runStep('0. Setup Contract Test Environment', async () => {
      gateway = new RecoveryGateway();
      apiServer = new ProductApiServer({ gateway });
      await new Promise(resolve => apiServer.listen(testPort, resolve));
    });

    // 1. Submit Recovery via Product HTTP API
    await runStep('1. [PRODUCT_CONTRACT_E2E] POST /api/v1/recoveries enqueues job and returns 201 Created', async () => {
      const fixtureSource = 'print("Valax Contract E2E Test Script")';
      const res = await request(apiServer, {
        path: '/api/v1/recoveries',
        method: 'POST',
        headers: {
          'X-Development-Principal': principal
        }
      }, {
        filename: 'contract_test.lua',
        source: fixtureSource
      });

      assert.strictEqual(res.statusCode, 201);
      assert.ok(res.json.jobId);
      assert.strictEqual(res.json.state, ProductJobState.QUEUED);
      assert.strictEqual(res.json.links.self, `/api/v1/recoveries/${res.json.jobId}`);
      jobId = res.json.jobId;
    });

    // 2. Poll Status While QUEUED
    await runStep('2. [PRODUCT_CONTRACT_E2E] GET /api/v1/recoveries/:jobId returns QUEUED progress', async () => {
      const res = await request(apiServer, {
        path: `/api/v1/recoveries/${jobId}`,
        headers: { 'X-Development-Principal': principal }
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.jobId, jobId);
      assert.strictEqual(res.json.state, ProductJobState.QUEUED);
      assert.strictEqual(res.json.progress.stage, 'recovering');
    });

    // 3. Process Job Through Worker Gateway
    await runStep('3. [PRODUCT_CONTRACT_E2E] Gateway processes next job through worker execution', () => {
      const workerResponse = gateway.processNextJobSync('contract-worker-1');
      assert.ok(workerResponse !== null);
      assert.strictEqual(workerResponse.status, 'completed');
    });

    // 4. Verify Terminal SUCCEEDED State Schema
    await runStep('4. [PRODUCT_CONTRACT_E2E] GET /api/v1/recoveries/:jobId transitions to SUCCEEDED with full schema', async () => {
      const res = await request(apiServer, {
        path: `/api/v1/recoveries/${jobId}`,
        headers: { 'X-Development-Principal': principal }
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.state, ProductJobState.SUCCEEDED);
      assert.strictEqual(res.json.progress.stage, 'complete');
      assert.ok(res.json.recovery);
      assert.ok(res.json.recovery.level);
      assert.strictEqual(res.json.recovery.semanticStatus, 'CONSERVATIVE');
      assert.ok(typeof res.json.recovery.metrics.durationMs === 'number');
    });

    // 5. List Artifacts
    await runStep('5. [PRODUCT_CONTRACT_E2E] GET /api/v1/recoveries/:jobId/artifacts lists available downloads', async () => {
      const res = await request(apiServer, {
        path: `/api/v1/recoveries/${jobId}/artifacts`,
        headers: { 'X-Development-Principal': principal }
      });

      assert.strictEqual(res.statusCode, 200);
      assert.ok(Array.isArray(res.json.artifacts));
      assert.ok(res.json.artifacts.some(a => a.artifactId === 'recoveredCode'));
    });

    // 6. Download Recovered Code
    await runStep('6. [PRODUCT_CONTRACT_E2E] GET /api/v1/recoveries/:jobId/artifacts/recoveredCode downloads recovered source', async () => {
      const res = await request(apiServer, {
        path: `/api/v1/recoveries/${jobId}/artifacts/recoveredCode`,
        headers: { 'X-Development-Principal': principal }
      });

      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.data.includes('print'));
      assert.ok(res.headers['content-type'].includes('text/x-lua'));
    });

  } finally {
    if (apiServer) {
      await new Promise(resolve => apiServer.close(resolve));
    }
  }

  const auditDir = path.resolve(__dirname, '../../audit');
  if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(
    path.join(auditDir, 'phase3-product-contract-e2e.json'),
    JSON.stringify({
      testSuite: 'PRODUCT_CONTRACT_E2E',
      timestamp: new Date().toISOString(),
      label: 'PRODUCT_CONTRACT_E2E (In-Process Mock Execution)',
      runs: contractResults,
      summary: {
        total: passed + failed,
        passed,
        failed,
        verdict: failed === 0 ? 'PRODUCT_CONTRACT_E2E_PASS' : 'PRODUCT_CONTRACT_E2E_FAIL'
      }
    }, null, 2),
    'utf8'
  );

  console.log('\n========================================');
  console.log(`Contract E2E Results: ${passed}/${passed + failed} Passed (${failed} Failed)`);
  if (failed === 0) {
    console.log('ALL PRODUCT CONTRACT E2E TESTS PASSED [PASS]');
  }
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  runProductContractE2ETests().catch(err => {
    console.error('Fatal contract test runner error:', err);
    process.exit(1);
  });
}

module.exports = { runProductContractE2ETests };
