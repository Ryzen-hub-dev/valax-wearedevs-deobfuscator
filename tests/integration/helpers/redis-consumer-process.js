const { MinimalRedisClient, RedisQueueAdapter } = require('../../../packages/queue/src');

async function main() {
  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const prefix = process.env.REDIS_PREFIX || 'valax:test:mp:';
  const workerId = 'os-worker-pid-' + process.pid;

  const client = new MinimalRedisClient({ host, port });
  await client.connect();

  const adapter = new RedisQueueAdapter({ client, prefix });
  const lease = await adapter.leaseNextJob(workerId, 10000);

  if (!lease || !lease.job) {
    process.stdout.write(JSON.stringify({ role: 'CONSUMER', pid: process.pid, event: 'NO_JOB' }) + '\n');
    await adapter.disconnect();
    process.exit(0);
  }

  const completed = await adapter.completeJob(lease.job.jobId, lease.leaseToken, {
    success: true,
    processedByPid: process.pid,
    workerId
  });

  const output = {
    role: 'CONSUMER',
    pid: process.pid,
    event: 'COMPLETED',
    jobId: lease.job.jobId,
    leaseToken: lease.leaseToken,
    completed
  };

  process.stdout.write(JSON.stringify(output) + '\n');
  await adapter.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Consumer error:', err);
  process.exit(1);
});
