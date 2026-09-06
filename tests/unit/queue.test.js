const assert = require('assert');
const { describe, test } = require('../test-framework');
const { InMemoryJobQueue, JobState, isValidTransition } = require('../../packages/queue/src');

function runQueueTests() {
  describe('In-Memory Job Queue & Scheduling Tests', () => {

    test('1. State transition validator correctly enforces rules', () => {
      assert.strictEqual(isValidTransition(JobState.QUEUED, JobState.RUNNING), true);
      assert.strictEqual(isValidTransition(JobState.QUEUED, JobState.CANCELLED), true);
      assert.strictEqual(isValidTransition(JobState.RUNNING, JobState.COMPLETED), true);
      assert.strictEqual(isValidTransition(JobState.RUNNING, JobState.FAILED), true);
      assert.strictEqual(isValidTransition(JobState.COMPLETED, JobState.RUNNING), false);
      assert.strictEqual(isValidTransition(JobState.CANCELLED, JobState.COMPLETED), false);
    });

    test('2. Enqueue handles duplicate idempotency keys correctly', () => {
      const queue = new InMemoryJobQueue();
      const sub1 = queue.enqueue({
        jobId: 'job-1',
        idempotencyKey: 'idem-key-1',
        principalId: 'user-a',
        payload: { data: 123 }
      });

      assert.strictEqual(sub1.isDuplicate, false);
      assert.strictEqual(sub1.job.state, JobState.QUEUED);

      const sub2 = queue.enqueue({
        jobId: 'job-2',
        idempotencyKey: 'idem-key-1',
        principalId: 'user-a',
        payload: { data: 456 }
      });

      assert.strictEqual(sub2.isDuplicate, true);
      assert.strictEqual(sub2.job.jobId, 'job-1');
    });

    test('3. Backpressure limits queue depth', () => {
      const queue = new InMemoryJobQueue({ maxQueueDepth: 2 });
      queue.enqueue({ jobId: 'j1', payload: {} });
      queue.enqueue({ jobId: 'j2', payload: {} });

      assert.throws(() => {
        queue.enqueue({ jobId: 'j3', payload: {} });
      }, /backpressure exceeded/i);
    });

    test('4. Leasing and completion with security tokens verified', () => {
      const queue = new InMemoryJobQueue();
      queue.enqueue({ jobId: 'lease-test-1', payload: {} });

      const leased = queue.leaseNextJob('worker-node-1', 5000);
      assert.ok(leased !== null);
      assert.strictEqual(leased.job.jobId, 'lease-test-1');
      assert.strictEqual(leased.job.state, JobState.RUNNING);
      assert.ok(typeof leased.leaseToken === 'string');

      // Reject wrong token
      const wrongTokenRes = queue.completeJob('lease-test-1', 'bad-token', { success: true });
      assert.strictEqual(wrongTokenRes, false);

      // Complete with correct token
      const okRes = queue.completeJob('lease-test-1', leased.leaseToken, { output: 'done' });
      assert.strictEqual(okRes, true);

      const completedJob = queue.getJob('lease-test-1');
      assert.strictEqual(completedJob.state, JobState.COMPLETED);
      assert.deepStrictEqual(completedJob.result, { output: 'done' });
    });

    test('5. Heartbeat successfully extends lease expiration', () => {
      const queue = new InMemoryJobQueue({ defaultLeaseDurationMs: 1000 });
      queue.enqueue({ jobId: 'hb-job', payload: {} });
      const leased = queue.leaseNextJob('worker-1');
      const initialExpiry = leased.expiresAt;

      const renewed = queue.heartbeat('hb-job', leased.leaseToken, 5000);
      assert.strictEqual(renewed, true);
      const lease = queue.leases.get('hb-job');
      assert.ok(lease.expiresAt > initialExpiry);
    });

    test('6. Stale lease without retries remaining transitions to TIMED_OUT', () => {
      const queue = new InMemoryJobQueue({ defaultLeaseDurationMs: 10, maxRetries: 1 });
      queue.enqueue({ jobId: 'stale-job', payload: {} });
      const leased = queue.leaseNextJob('worker-fail', 10);
      assert.strictEqual(leased.job.attempts, 1);

      // Artificially expire the lease
      queue.leases.get('stale-job').expiresAt = Date.now() - 100;

      // Trigger lease reclaim
      queue._reclaimStaleLeases();
      const jobAfterReclaim = queue.getJob('stale-job');
      assert.strictEqual(jobAfterReclaim.state, JobState.TIMED_OUT);
    });

    test('7. Cancellation transitions job to CANCELLED state', () => {
      const queue = new InMemoryJobQueue();
      queue.enqueue({ jobId: 'cancel-me', payload: {} });
      const cancelled = queue.cancelJob('cancel-me', 'User requested stop');
      assert.strictEqual(cancelled, true);

      const job = queue.getJob('cancel-me');
      assert.strictEqual(job.state, JobState.CANCELLED);
    });

  });
}

module.exports = { runQueueTests };

if (require.main === module) {
  const { printSummary } = require('../test-framework');
  runQueueTests();
  printSummary();
}
