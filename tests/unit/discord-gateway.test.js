const assert = require('assert');
const { CooldownStore, formatRemaining, hasSupportStatus } = require('../../apps/discord-bot/src/access');
const { isPrivateIp } = require('../../apps/discord-bot/src/safe-fetch');

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

  console.log('Discord gateway access tests passed.');
}

if (require.main === module) run();
module.exports = { run };
