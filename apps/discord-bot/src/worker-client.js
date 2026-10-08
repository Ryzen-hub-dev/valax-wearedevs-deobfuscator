const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');

const WORKER_ENTRY = path.resolve(__dirname, '../../../packages/worker/src/index.js');
const MAX_WORKER_RESPONSE_BYTES = 8 * 1024 * 1024;

function buildWorkerRequest(input, config, requestedStage = 'L5') {
  const sourceBytes = Buffer.byteLength(input.source, 'utf8');
  return {
    schemaVersion: '1',
    jobId: crypto.randomUUID(),
    input: {
      filename: input.filename,
      source: input.source,
      bytes: sourceBytes,
      sha256: crypto.createHash('sha256').update(input.source, 'utf8').digest('hex')
    },
    options: {
      requestedStage,
      semanticValidation: true
    },
    limits: {
      timeoutMs: config.workerTimeoutMs,
      maxInputBytes: config.maxSourceBytes,
      maxOutputBytes: 3_500_000
    }
  };
}

function classifyWorkerExit(code, stderr = '') {
  if (
    code === 134 ||
    /heap out of memory|allocation failed|ineffective mark-compacts/i.test(stderr)
  ) {
    const error = new Error('Local recovery exceeded its isolated memory budget.');
    error.code = 'WORKER_RESOURCE_LIMIT';
    return error;
  }

  const error = new Error(
    code === null
      ? 'Recovery worker was terminated by its resource limit.'
      : `Recovery worker exited without a valid response (exit ${code}).`
  );
  error.code = 'WORKER_INVALID_RESPONSE';
  return error;
}

function recoverInWorker(input, config, requestedStage = 'L5') {
  const request = buildWorkerRequest(input, config, requestedStage);

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${config.workerMemoryMb}`, WORKER_ENTRY],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    );
    let stdout = '';
    let stderr = '';
    let responseBytes = 0;
    let settled = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const error = new Error(`Recovery worker exceeded ${config.workerTimeoutMs / 1000} seconds.`);
      error.code = 'WORKER_TIMEOUT';
      finish(error);
    }, config.workerTimeoutMs + 2_000);

    child.once('error', error => {
      error.code = 'WORKER_UNAVAILABLE';
      finish(error);
    });

    child.stdout.on('data', chunk => {
      responseBytes += chunk.length;
      if (responseBytes > MAX_WORKER_RESPONSE_BYTES) {
        child.kill('SIGKILL');
        const error = new Error('Recovery worker response exceeded the safe output limit.');
        error.code = 'WORKER_OUTPUT_LIMIT';
        finish(error);
        return;
      }
      stdout += chunk;
    });

    child.stderr.on('data', chunk => {
      if (stderr.length < 8_000) stderr += chunk;
    });

    child.once('close', code => {
      if (settled) return;
      let response;
      try {
        response = JSON.parse(stdout);
      } catch {
        const error = classifyWorkerExit(code, stderr);
        if (error.code === 'WORKER_RESOURCE_LIMIT') {
          console.error(`Recovery worker hit its memory limit (exit ${code}).`);
        } else if (stderr) {
          console.error('Recovery worker stderr:', stderr);
        }
        finish(error);
        return;
      }

      if (response.status !== 'completed' || !response.artifacts?.recoveredCode) {
        const error = new Error(response.error?.message || `Recovery worker ended with status ${response.status}.`);
        error.code = response.error?.code || response.status || 'WORKER_FAILED';
        finish(error);
        return;
      }

      finish(null, {
        success: true,
        code: response.artifacts.recoveredCode,
        report: response.artifacts.report || {
          recoveryLevel: response.admission?.admittedTier,
          execution: {
            requestedStage: 'L5',
            executedStage: response.metrics?.admittedStage || response.admission?.admittedTier
          }
        }
      });
    });

    child.stdin.end(JSON.stringify(request));
  });
}

module.exports = { buildWorkerRequest, classifyWorkerExit, recoverInWorker };
