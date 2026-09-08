/**
 * Integration Test Suite for Discord Bot Adapter & Attachment SSRF Guards.
 */

const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const { AttachmentFetcher } = require('../../packages/discord/src/attachment-fetcher');
const { ProductApiClient } = require('../../packages/discord/src/api-client');
const { DiscordBotAdapter } = require('../../packages/discord/src/gateway-adapter');
const { ProductApiServer, Principal } = require('../../packages/api/src');
const { RecoveryGateway } = require('../../packages/gateway/src');
const { InMemoryJobQueue } = require('../../packages/queue/src');

let passed = 0;
let failed = 0;
const results = [];

async function test(name, fn) {
  try {
    const start = Date.now();
    await fn();
    const duration = Date.now() - start;
    passed++;
    results.push({ name, status: 'PASS', duration });
    console.log(`  [PASS] ${name} (${duration}ms)`);
  } catch (err) {
    failed++;
    results.push({ name, status: 'FAIL', error: err.message });
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
  }
}

async function runDiscordBotTests() {
  console.log('\n=== Phase 3 Round 2 — Discord Bot & SSRF Security Tests ===');

  const fetcher = new AttachmentFetcher();

  // --- 1. SSRF Negative Guards (P0-26) ---
  await test('P0-26: Rejects HTTP protocol (requires HTTPS)', async () => {
    assert.throws(() => {
      fetcher.validateUrl('http://cdn.discordapp.com/test.lua');
    }, /Insecure protocol/);
  });

  await test('P0-26: Rejects file:// URI scheme', async () => {
    assert.throws(() => {
      fetcher.validateUrl('file:///etc/passwd');
    }, /Insecure protocol/);
  });

  await test('P0-26: Rejects loopback IP (127.0.0.1)', async () => {
    assert.throws(() => {
      fetcher.validateUrl('https://127.0.0.1/evil.lua');
    }, /not in the approved Discord CDN allowlist/);
  });

  await test('P0-26: Rejects cloud metadata IP (169.254.169.254)', async () => {
    assert.throws(() => {
      fetcher.validateUrl('https://169.254.169.254/latest/meta-data/');
    }, /not in the approved Discord CDN allowlist/);
  });

  await test('P0-26: Rejects external untrusted host (https://attacker.example)', async () => {
    assert.throws(() => {
      fetcher.validateUrl('https://attacker.example/malicious.lua');
    }, /not in the approved Discord CDN allowlist/);
  });

  await test('P0-26: Rejects private RFC1918 IPs in isPrivateIp guard', async () => {
    assert.strictEqual(fetcher.isPrivateIp('127.0.0.1'), true);
    assert.strictEqual(fetcher.isPrivateIp('10.0.0.1'), true);
    assert.strictEqual(fetcher.isPrivateIp('172.16.0.1'), true);
    assert.strictEqual(fetcher.isPrivateIp('192.168.1.1'), true);
    assert.strictEqual(fetcher.isPrivateIp('169.254.169.254'), true);
    assert.strictEqual(fetcher.isPrivateIp('::1'), true);
    assert.strictEqual(fetcher.isPrivateIp('8.8.8.8'), false);
  });

  await test('P0-26: Accepts valid Discord CDN host', async () => {
    const url = fetcher.validateUrl('https://cdn.discordapp.com/attachments/123/456/script.lua');
    assert.strictEqual(url.hostname, 'cdn.discordapp.com');
  });

  // --- 2. Live API Integration & Cross-User Denial (P0-28, P0-29, P0-30, P0-39) ---
  const queue = new InMemoryJobQueue();
  const gateway = new RecoveryGateway({ queue });
  const server = new ProductApiServer({
    gateway,
    botServiceSecret: 'bot-secret-key-123'
  });
  const port = await server.start(0);

  const apiClient = new ProductApiClient({
    apiBaseUrl: `http://127.0.0.1:${port}`,
    serviceSecret: 'bot-secret-key-123'
  });

  const adapter = new DiscordBotAdapter({ apiClient });

  let aliceJobId = null;

  await test('P0-25 & P0-30: Bot submits recovery via ProductApiClient with signed assertion', async () => {
    const res = await apiClient.submitRecovery('discord-user-alice', {
      filename: 'test.lua',
      source: 'print("hello from discord bot")',
      options: { stage: 'L5' }
    }, { username: 'alice' });

    assert(res.statusCode === 201 || res.statusCode === 202);
    assert(res.json.jobId);
    assert.strictEqual(res.json.status, 'QUEUED');
    aliceJobId = res.json.jobId;
  });

  await test('P0-29: Same Discord user can check status of their job', async () => {
    const res = await apiClient.getRecovery('discord-user-alice', aliceJobId);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json.jobId, aliceJobId);
  });

  await test('P0-29 & P0-39: Different Discord user is FORBIDDEN (403) from checking status', async () => {
    let forbiddenCaught = false;
    try {
      await apiClient.getRecovery('discord-user-bob-attacker', aliceJobId);
    } catch (err) {
      if (err.statusCode === 403) {
        forbiddenCaught = true;
      }
    }
    assert.strictEqual(forbiddenCaught, true, 'Bob must receive 403 Forbidden on Alice job');
  });

  await test('P0-29 & P0-39: Different Discord user is FORBIDDEN (403) from cancelling job', async () => {
    let forbiddenCaught = false;
    try {
      await apiClient.cancelRecovery('discord-user-bob-attacker', aliceJobId);
    } catch (err) {
      if (err.statusCode === 403) {
        forbiddenCaught = true;
      }
    }
    assert.strictEqual(forbiddenCaught, true, 'Bob must receive 403 Forbidden when trying to cancel Alice job');
  });

  await test('P0-24 & P0-29: Alice can cancel her own job', async () => {
    const res = await apiClient.cancelRecovery('discord-user-alice', aliceJobId);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json.status, 'CANCELLED');
  });

  await server.close();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`${failed} discord bot integration tests failed`);
  }
}

if (require.main === module) {
  runDiscordBotTests().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  runDiscordBotTests
};
