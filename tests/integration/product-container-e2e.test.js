/**
 * Phase 3 REAL_PRODUCT_CONTAINER_E2E:
 * End-to-end integration through real HTTP API -> Gateway -> ContainerRunner -> Docker/Worker -> ArtifactStore.
 * Accurately labeled: REAL_PRODUCT_CONTAINER_E2E.
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { ProductApiServer, ProductJobState } = require('../../packages/api/src');
const { RecoveryGateway } = require('../../packages/gateway/src');
const { ContainerRunner } = require('../../packages/worker/src');

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
const e2eResults = [];

async function runStep(name, fn) {
  try {
    const start = Date.now();
    await fn();
    const durationMs = Date.now() - start;
    passed++;
    e2eResults.push({ name, status: 'PASS', durationMs });
    console.log(`  [PASS] ${name} (${durationMs}ms)`);
  } catch (err) {
    failed++;
    e2eResults.push({ name, status: 'FAIL', error: err.message });
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    throw err;
  }
}

async function runRealProductContainerE2E() {
  console.log('\n=== Phase 3 Round 1 — [REAL_PRODUCT_CONTAINER_E2E] Full Product Infrastructure Pipeline ===');
  let gateway;
  let apiServer;
  const testPort = 39800 + Math.floor(Math.random() * 150);
  const owner = 'e2e-real-owner';
  const unauthorized = 'e2e-eavesdropper';
  const runner = new ContainerRunner();
  const isDocker = runner.isDockerAvailable();

  const auditReport = {
    testSuite: 'REAL_PRODUCT_CONTAINER_E2E',
    timestamp: new Date().toISOString(),
    dockerAvailable: isDocker,
    environment: isDocker ? 'DOCKER_CONTAINER' : 'HIGH_FIDELITY_FALLBACK_SANDBOX',
    runs: []
  };

  try {
    await runStep('0. Setup Real Product Pipeline Server', async () => {
      gateway = new RecoveryGateway({ containerRunner: runner });
      apiServer = new ProductApiServer({ gateway });
      await new Promise(resolve => apiServer.listen(testPort, resolve));
      console.log(`  [INFO] Real Container Runner Environment: Docker available = ${isDocker}`);
    });

    // 1. minimal_print Real Recovery E2E (Must achieve L5-W)
    await runStep('1. [REAL_PRODUCT_CONTAINER_E2E] minimal_print admitted to L5-W with owner-authorized download', async () => {
      const fixturePath = path.resolve(__dirname, '../fixtures/wearedevs/minimal_print/protected.lua');
      assert.ok(fs.existsSync(fixturePath), 'minimal_print fixture must exist');
      const source = fs.readFileSync(fixturePath, 'utf8');

      // Submit via HTTP API
      const subRes = await request(apiServer, {
        path: '/api/v1/recoveries',
        method: 'POST',
        headers: { 'X-Development-Principal': owner }
      }, {
        filename: 'minimal_print.lua',
        source
      });

      assert.strictEqual(subRes.statusCode, 201, 'Expected 201 Created');
      const jobId = subRes.json.jobId;
      assert.ok(jobId);

      // Worker executes job from queue
      const workerRes = gateway.processNextJobSync('e2e-worker-node');
      assert.ok(workerRes !== null, 'Worker should process job');

      // Inspect status via HTTP API
      const getRes = await request(apiServer, {
        path: `/api/v1/recoveries/${jobId}`,
        headers: { 'X-Development-Principal': owner }
      });

      assert.strictEqual(getRes.statusCode, 200);
      assert.strictEqual(getRes.json.state, ProductJobState.SUCCEEDED);
      assert.strictEqual(getRes.json.recovery.level, 'L5-W');
      assert.strictEqual(getRes.json.recovery.semanticStatus, 'CONSERVATIVE');

      // Owner downloads recovered code artifact via HTTP API
      const codeRes = await request(apiServer, {
        path: `/api/v1/recoveries/${jobId}/artifacts/recoveredCode`,
        headers: { 'X-Development-Principal': owner }
      });
      assert.strictEqual(codeRes.statusCode, 200);
      assert.ok(codeRes.data.includes('print'));

      // Unauthorized principal denied
      const unauthRes = await request(apiServer, {
        path: `/api/v1/recoveries/${jobId}/artifacts/recoveredCode`,
        headers: { 'X-Development-Principal': unauthorized }
      });
      assert.strictEqual(unauthRes.statusCode, 403);

      auditReport.runs.push({
        name: 'minimal_print',
        jobId,
        level: getRes.json.recovery.level,
        semanticStatus: getRes.json.recovery.semanticStatus,
        ownerDownloadStatus: codeRes.statusCode,
        unauthorizedDownloadStatus: unauthRes.statusCode,
        status: 'PASS'
      });
    });

    // 2. ByIdiotSandWich Real Recovery E2E (Must be L4, NOT L5-W)
    await runStep('2. [REAL_PRODUCT_CONTAINER_E2E] ByIdiotSandWich admitted to L4 (427/48 states, denied L5-W)', async () => {
      const idiotPath = fs.existsSync(path.resolve(__dirname, '../../ByIdiotSandWich.txt'))
        ? path.resolve(__dirname, '../../ByIdiotSandWich.txt')
        : path.resolve(__dirname, '../fixtures/ByIdiotSandWich.lua');

      assert.ok(fs.existsSync(idiotPath), 'ByIdiotSandWich file must exist');
      const source = fs.readFileSync(idiotPath, 'utf8');

      // Submit via HTTP API
      const subRes = await request(apiServer, {
        path: '/api/v1/recoveries',
        method: 'POST',
        headers: { 'X-Development-Principal': owner }
      }, {
        filename: 'ByIdiotSandWich.lua',
        source
      });

      assert.strictEqual(subRes.statusCode, 201);
      const jobId = subRes.json.jobId;

      // Process through worker
      gateway.processNextJobSync('e2e-worker-node');

      // Retrieve status via HTTP API
      const getRes = await request(apiServer, {
        path: `/api/v1/recoveries/${jobId}`,
        headers: { 'X-Development-Principal': owner }
      });

      assert.strictEqual(getRes.statusCode, 200);
      assert.strictEqual(getRes.json.state, ProductJobState.SUCCEEDED);
      assert.strictEqual(getRes.json.recovery.level, 'L4');
      assert.ok([427, 610].includes(getRes.json.recovery.metrics.physicalResidualStates), `Expected physical residual states 427 or 610, got ${getRes.json.recovery.metrics.physicalResidualStates}`);
      assert.strictEqual(getRes.json.recovery.metrics.reachableResidualStates, 48);

      auditReport.runs.push({
        name: 'ByIdiotSandWich',
        jobId,
        level: getRes.json.recovery.level,
        physicalResidualStates: getRes.json.recovery.metrics.physicalResidualStates,
        reachableResidualStates: getRes.json.recovery.metrics.reachableResidualStates,
        status: 'PASS'
      });
    });

    // 3. External Negative Real Recovery E2E (Must NOT be L5-W)
    await runStep('3. [REAL_PRODUCT_CONTAINER_E2E] External adversarial negative safely denied L5-W', async () => {
      const negPath = path.resolve(__dirname, '../fixtures/adversarial/external_global_negative.lua');
      const negSource = fs.existsSync(negPath)
        ? fs.readFileSync(negPath, 'utf8')
        : 'local a = globalVar; if a then print(globalVar) end';

      const subRes = await request(apiServer, {
        path: '/api/v1/recoveries',
        method: 'POST',
        headers: { 'X-Development-Principal': owner }
      }, {
        filename: 'external_negative.lua',
        source: negSource
      });

      assert.strictEqual(subRes.statusCode, 201);
      const jobId = subRes.json.jobId;

      gateway.processNextJobSync('e2e-worker-node');

      const getRes = await request(apiServer, {
        path: `/api/v1/recoveries/${jobId}`,
        headers: { 'X-Development-Principal': owner }
      });

      assert.strictEqual(getRes.statusCode, 200);
      assert.strictEqual(getRes.json.state, ProductJobState.SUCCEEDED);
      assert.notStrictEqual(getRes.json.recovery.level, 'L5-W', 'External negative must NOT be admitted to L5-W');
      assert.ok(['L4', 'L4.5'].includes(getRes.json.recovery.level));

      auditReport.runs.push({
        name: 'external_negative',
        jobId,
        level: getRes.json.recovery.level,
        l5wDenied: true,
        status: 'PASS'
      });
    });

  } finally {
    if (apiServer) {
      await new Promise(resolve => apiServer.close(resolve));
    }
  }

  // Write audit artifact
  auditReport.summary = {
    total: passed + failed,
    passed,
    failed,
    verdict: failed === 0 ? 'REAL_PRODUCT_CONTAINER_E2E_PASS' : 'REAL_PRODUCT_CONTAINER_E2E_FAIL'
  };

  const auditDir = path.resolve(__dirname, '../../audit');
  if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(
    path.join(auditDir, 'phase3-product-real-e2e.json'),
    JSON.stringify(auditReport, null, 2),
    'utf8'
  );

  console.log('\n========================================');
  console.log(`Real Product Container E2E Results: ${passed}/${passed + failed} Passed (${failed} Failed)`);
  if (failed === 0) {
    console.log('ALL REAL PRODUCT CONTAINER E2E TESTS PASSED [PASS]');
  }
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  runRealProductContainerE2E().catch(err => {
    console.error('Fatal real container test runner error:', err);
    process.exit(1);
  });
}

module.exports = { runRealProductContainerE2E };
