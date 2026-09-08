/**
 * Standalone Product Worker Daemon:
 * Runs as a separate OS process polling a Redis queue for deobfuscation jobs,
 * executing them inside ContainerRunner (Docker or high-fidelity sandbox),
 * and writing output artifacts to a shared FilesystemArtifactStore.
 */

const path = require('path');
const fs = require('fs');
const { MinimalRedisClient, RedisQueueAdapter } = require('../packages/queue/src');
const { ContainerRunner } = require('../packages/worker/src');
const { FilesystemArtifactStore } = require('../packages/gateway/src');

async function main() {
  const args = process.argv.slice(2);
  let redisHost = '127.0.0.1';
  let redisPort = 6379;
  let queuePrefix = 'valax:e2e:queue:';
  let artifactsDir = path.resolve(process.cwd(), 'audit/shared-artifacts');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) redisPort = parseInt(args[++i], 10);
    if (args[i] === '--host' && args[i + 1]) redisHost = args[++i];
    if (args[i] === '--prefix' && args[i + 1]) queuePrefix = args[++i];
    if (args[i] === '--artifacts' && args[i + 1]) artifactsDir = path.resolve(args[++i]);
  }

  const client = new MinimalRedisClient({ host: redisHost, port: redisPort });
  client.on('error', () => {});
  await client.connect();

  const runner = new ContainerRunner();
  const artifactStore = new FilesystemArtifactStore({ baseDir: artifactsDir });
  const isDocker = runner.isDockerAvailable();

  const waitingKey = `${queuePrefix}waiting`;
  let running = true;

  function shutdown() {
    running = false;
    setTimeout(() => process.exit(0), 100);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('message', (msg) => {
    if (msg === 'SHUTDOWN' || (msg && msg.command === 'STOP')) {
      shutdown();
    }
  });

  // Notify parent process via IPC or stdout
  const readyInfo = {
    event: 'WORKER_READY',
    pid: process.pid,
    redisHost,
    redisPort,
    dockerAvailable: isDocker
  };
  if (process.send) {
    process.send(readyInfo);
  }
  console.log(JSON.stringify(readyInfo));

  while (running) {
    try {
      const jobId = await client.sendCommand(['RPOP', waitingKey]);
      if (!jobId) {
        await new Promise(r => setTimeout(r, 50));
        continue;
      }
      console.log(`[worker] Popped job ${jobId} from ${waitingKey}`);

      const jobKey = `${queuePrefix}job:${jobId}`;
      const rawJob = await client.sendCommand(['GET', jobKey]);
      if (!rawJob) continue;

      const job = JSON.parse(rawJob);
      job.state = 'RUNNING';
      job.updatedAt = new Date().toISOString();
      await client.sendCommand(['SET', jobKey, JSON.stringify(job)]);

      // Execute through container runner
      const workerResponse = await runner.runJob(job.payload);

      // Save artifacts to shared disk
      if (workerResponse.artifacts?.recoveredCode) {
        artifactStore.saveRecoveredCode(job.jobId, workerResponse.artifacts.recoveredCode);
      }
      if (workerResponse.admission) {
        artifactStore.saveReport(job.jobId, {
          admission: workerResponse.admission,
          metrics: workerResponse.metrics
        });
      }
      artifactStore.purgeSourceCode(job.jobId);

      // Mark completed in Redis
      job.state = 'COMPLETED';
      job.result = workerResponse;
      job.updatedAt = new Date().toISOString();
      await client.sendCommand(['SET', jobKey, JSON.stringify(job)]);

      const completedInfo = {
        event: 'JOB_COMPLETED',
        jobId: job.jobId,
        pid: process.pid,
        status: workerResponse.status,
        level: workerResponse.admission?.admittedTier || 'NONE'
      };
      if (process.send) {
        process.send(completedInfo);
      }
      console.log(JSON.stringify(completedInfo));

    } catch (err) {
      if (!running) break;
      console.error('[worker error]', err);
      await new Promise(r => setTimeout(r, 100));
    }
  }
}

main().catch(err => {
  console.error('Fatal worker daemon error:', err);
  process.exit(1);
});
