/**
 * @valax/worker:
 * Hosted worker container entrypoint and exports.
 */

const { WorkerProtocol, WorkerStatus, PROTOCOL_VERSION } = require('./protocol');
const { CoreBaselineGuard } = require('./core-baseline-guard');
const { WorkerExecutor } = require('./worker-executor');
const { ContainerRunner } = require('./container-runner');

// Stdin/Stdout CLI execution mode when run directly inside container
if (require.main === module) {
  let rawInput = '';
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', chunk => {
    rawInput += chunk;
  });

  process.stdin.on('end', async () => {
    try {
      if (!rawInput.trim()) {
        const errResp = WorkerProtocol.createResponse({
          jobId: 'unknown',
          status: WorkerStatus.FAILED,
          error: { code: 'EMPTY_INPUT', message: 'No input provided on stdin' }
        });
        process.stdout.write(JSON.stringify(errResp));
        process.exit(1);
      }

      const request = JSON.parse(rawInput);
      const executor = new WorkerExecutor();
      const response = await executor.executeJob(request);
      process.stdout.write(JSON.stringify(response));
      process.exit(0);
    } catch (err) {
      const errResp = WorkerProtocol.createResponse({
        jobId: 'unknown',
        status: WorkerStatus.FAILED,
        error: { code: 'FATAL_WORKER_ERROR', message: err.message, details: err.stack }
      });
      process.stdout.write(JSON.stringify(errResp));
      process.exit(1);
    }
  });
}

module.exports = {
  PROTOCOL_VERSION,
  WorkerProtocol,
  WorkerStatus,
  CoreBaselineGuard,
  WorkerExecutor,
  ContainerRunner
};
