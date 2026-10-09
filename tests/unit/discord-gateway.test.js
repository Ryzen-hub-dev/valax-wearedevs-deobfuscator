const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CooldownStore, formatRemaining, hasSupportStatus } = require('../../apps/discord-bot/src/access');
const { isPrivateIp } = require('../../apps/discord-bot/src/safe-fetch');
const {
  buildWorkerRequest,
  classifyWorkerExit,
  hostedFallbackStages
} = require('../../apps/discord-bot/src/worker-client');
const { readBoolean, readTokenList } = require('../../apps/discord-bot/src/config');
const { VoiceService, privateVoiceName, shouldOnboard } = require('../../apps/discord-bot/src/voice-service');
const { CommunityStore, levelForXp } = require('../../apps/discord-bot/src/community-store');
const { INVITE_MILESTONES, cleanChannelName, formatDuration } = require('../../apps/discord-bot/src/community-service');

async function run() {
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
  assert.deepStrictEqual(readTokenList('token-a, token-b;token-a'), ['token-a', 'token-b']);

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
  assert.deepStrictEqual(hostedFallbackStages('WORKER_TIMEOUT'), ['L3', 'L2']);
  assert.deepStrictEqual(hostedFallbackStages('WORKER_UNAVAILABLE'), ['L5', 'L3', 'L2']);

  const onboardingMember = {
    id: '1234567890',
    user: { bot: false, username: 'New User!' },
    permissions: { has: () => false },
    roles: { cache: { has: () => false } }
  };
  assert.strictEqual(shouldOnboard(onboardingMember, 'verified'), true);
  assert.strictEqual(privateVoiceName(onboardingMember), 'welcome-new-user-7890');
  assert.strictEqual(shouldOnboard({ ...onboardingMember, user: { bot: true } }, 'verified'), false);
  assert.strictEqual(
    shouldOnboard({ ...onboardingMember, roles: { cache: { has: () => true } } }, 'verified'),
    false
  );

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'valax-community-'));
  try {
    let communityNow = 1_000_000;
    const communityStore = new CommunityStore(path.join(temporaryDirectory, 'community.json'), {
      now: () => communityNow
    });
    const daily = communityStore.claimDaily('member-1', { amount: 150, cooldownMs: 86_400_000 });
    assert.strictEqual(daily.ok, true);
    assert.strictEqual(communityStore.balance('member-1').coins, 150);
    const dailyAgain = communityStore.claimDaily('member-1', { amount: 150, cooldownMs: 86_400_000 });
    assert.strictEqual(dailyAgain.ok, false);
    communityStore.addCoins('member-2', 500, 'test reward');
    assert.strictEqual(communityStore.leaderboard(2)[0].userId, 'member-2');

    const ticket = communityStore.createTicket('member-1', 'channel-1');
    assert.strictEqual(ticket.created, true);
    assert.strictEqual(communityStore.createTicket('member-1', 'channel-2').created, false);
    communityStore.closeTicket(ticket.ticket.id, 'staff-1');
    assert.strictEqual(communityStore.snapshot().tickets.closed, 1);

    const drop = communityStore.createDrop('staff-1', 'Premium key', 'giveaways');
    assert.strictEqual(communityStore.claimDrop(drop.id, 'member-1').winnerId, 'member-1');
    assert.strictEqual(communityStore.claimDrop(drop.id, 'member-2'), null);
    assert.strictEqual(communityStore.balance('member-1').coins, 400);

    communityNow += 86_400_000;
    assert.strictEqual(communityStore.claimDaily('member-1').ok, true);
    const reloaded = new CommunityStore(path.join(temporaryDirectory, 'community.json'));
    assert.strictEqual(reloaded.snapshot().dropsClaimed, 1);
    assert.strictEqual(reloaded.snapshot().tickets.closed, 1);

    assert.strictEqual(communityStore.awardMessageXp('member-1', { amount: 100 }).leveledUp, true);
    assert.strictEqual(communityStore.awardMessageXp('member-1', { amount: 100 }).awarded, false);
    communityNow += 60_000;
    assert.strictEqual(communityStore.awardMessageXp('member-1', { amount: 100 }).awarded, true);
    assert.strictEqual(levelForXp(400), 3);

    assert.strictEqual(communityStore.submitCount('member-1', 1).accepted, true);
    assert.strictEqual(communityStore.submitCount('member-1', 2).accepted, false);
    assert.strictEqual(communityStore.submitCount('member-2', 1).accepted, true);
    assert.strictEqual(communityStore.snapshot().counting.highScore, 1);

    assert.strictEqual(communityStore.recordInvite('member-1', 'new-member', { eligible: true }).eligible, true);
    assert.strictEqual(communityStore.recordInvite('member-1', 'new-member', { eligible: true }).recorded, false);
    communityStore.recordInvite('member-1', 'new-member-2', { eligible: true });
    const rewards = communityStore.claimInviteRewards('member-1', INVITE_MILESTONES);
    assert.strictEqual(rewards.claimed, true);
    assert.strictEqual(rewards.amount, 250);
    assert.strictEqual(communityStore.claimInviteRewards('member-1', INVITE_MILESTONES).claimed, false);

    communityStore.addWarning('member-1', 'staff-1', 'Test warning');
    assert.strictEqual(communityStore.warningsFor('member-1').length, 1);
    assert.strictEqual(communityStore.clearWarnings('member-1'), 1);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  assert.strictEqual(cleanChannelName('Néw User!!'), 'new-user');
  assert.strictEqual(formatDuration(3_661_000), '1h 2m');

  const queueService = Object.create(VoiceService.prototype);
  queueService.helperWorkers = [{ id: 'h1', busy: false }, { id: 'h2', busy: false }];
  queueService.pendingOnboarding = [
    { memberId: 'm1', channelId: 'c1' },
    { memberId: 'm2', channelId: 'c2' },
    { memberId: 'm3', channelId: 'c3' }
  ];
  queueService.activeMembers = new Set(['m1', 'm2', 'm3']);
  const started = [];
  const finish = [];
  queueService.runOnboarding = (memberId, _channelId, worker) => new Promise(resolve => {
    started.push(`${memberId}:${worker.id}`);
    finish.push(resolve);
  });
  queueService.pumpHelperQueue();
  assert.deepStrictEqual(started, ['m1:h1', 'm2:h2']);
  assert.strictEqual(queueService.pendingOnboarding.length, 1);
  finish.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepStrictEqual(started, ['m1:h1', 'm2:h2', 'm3:h1']);
  while (finish.length > 0) finish.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(queueService.activeMembers.size, 0);

  console.log('Discord gateway access tests passed.');
}

if (require.main === module) run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
module.exports = { run };
