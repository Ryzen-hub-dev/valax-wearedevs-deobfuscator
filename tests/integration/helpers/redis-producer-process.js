const { MinimalRedisClient, RedisQueueAdapter } = require('../../../packages/queue/src');

async function main() {
  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const prefix = process.env.REDIS_PREFIX || 'valax:test:mp:';
  const jobId = process.argv[2] || 'os-proc-job-1';
  const idempotencyKey = process.argv[3] || 'os-proc-idem-1';

  const client = new MinimalRedisClient({ host, port });
  await client.connect();

  const adapter = new RedisQueueAdapter({ client, prefix });
  const result = await adapter.enqueue({
    jobId,
    idempotencyKey,
    principalId: 'os-producer-principal',
    payload: { task: 'multi-process-e2e', data: 42 }
  });

  const output = {
    role: 'PRODUCER',
    pid: process.pid,
    event: 'ENQUEUED',
    jobId: result.job.jobId,
    isDuplicate: result.isDuplicate,
    state: result.job.state
  };

  process.stdout.write(JSON.stringify(output) + '\n');
  await adapter.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Producer error:', err);
  process.exit(1);
});
