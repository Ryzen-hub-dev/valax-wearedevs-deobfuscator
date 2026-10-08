const assert = require('assert');
const { CooldownStore, formatRemaining, hasSupportStatus } = require('../../apps/discord-bot/src/access');
const { isPrivateIp } = require('../../apps/discord-bot/src/safe-fetch');
const { buildWorkerRequest, classifyWorkerExit } = require('../../apps/discord-bot/src/worker-client');
const { readBoolean } = require('../../apps/discord-bot/src/config');

function run() {
  assert.strictEqual(hasSupportStatus({
    activities: [{ type: 4, state: 'Support ValaxScrub.Shop', name: 'Custom Status' }]
  }, 'support valaxscrub.shop'), true);
  assert.strictEqual(hasSupportStatus({ activities: [{ type: 4, state: 'hello' }] }, 'support valaxscrub.shop'), false);
  assert.strictEqual(hasSupportStatus({
    activities: [{ type: 0, name: 'support valaxscrub.shop' }]
  }, 'support valaxscrub.shop'), false);

  let now = 10_000;
  const store = new CooldownStore(1_200_000, () => now);
  assert.strictEqual(store.remaining('u1'), 0);
  store.start('u1');
  assert.strictEqual(store.remaining('u1'), 1_200_000);
  now += 60_000;
  assert.strictEqual(store.remaining('u1'), 1_140_000);
  store.clear('u1');
  assert.strictEqual(store.remaining('u1'), 0);
  assert.strictEqual(formatRemaining(61_000), '1m 1s');

  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1']) {
    assert.strictEqual(isPrivateIp(address), true, `${address} should be private`);
  }
  assert.strictEqual(isPrivateIp('8.8.8.8'), false);

  assert.strictEqual(readBoolean(undefined, true), true);
  assert.strictEqual(readBoolean('false', true), false);
  assert.strictEqual(readBoolean('yes', false), true);

  const workerRequest = buildWorkerRequest(
    { source: 'print(1)', filename: 'test.lua' },
    { workerTimeoutMs: 90_000, maxSourceBytes: 2_000_000 },
    'L4'
  );
  assert.strictEqual(workerRequest.schemaVersion, '1');
  assert.strictEqual(workerRequest.input.bytes, 8);
  assert.strictEqual(workerRequest.input.sha256.length, 64);
  assert.strictEqual(workerRequest.options.requestedStage, 'L4');
  assert.strictEqual(workerRequest.limits.timeoutMs, 90_000);

  assert.strictEqual(classifyWorkerExit(134, '').code, 'WORKER_RESOURCE_LIMIT');
  assert.strictEqual(
    classifyWorkerExit(1, 'FATAL ERROR: Allocation failed - JavaScript heap out of memory').code,
    'WORKER_RESOURCE_LIMIT'
  );
  assert.strictEqual(classifyWorkerExit(1, 'unexpected crash').code, 'WORKER_INVALID_RESPONSE');

  console.log('Discord gateway access tests passed.');
}

if (require.main === module) run();
module.exports = { run };
