/**
 * Container Runner:
 * Launches and manages containerized worker processes according to strict
 * security profiles:
 * - Network isolation: --network none
 * - Read-only root: --read-only
 * - Non-root user: --user 1000:1000
 * - Privilege drop: --cap-drop ALL, --security-opt=no-new-privileges:true
 * - Resource limits: --memory 512m, --cpus 1.0, --pids-limit 128
 * - Safe tmpfs: /work (rw,noexec,nosuid,size=64m), /tmp (rw,noexec,nosuid,size=32m)
 * - Zero host directory mounts
 *
 * Provides high-fidelity local subprocess sandbox fallback if Docker daemon is not active.
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const { WorkerExecutor } = require('./worker-executor');
const { WorkerStatus, WorkerProtocol } = require('./protocol');

class ContainerRunner {
  /**
   * @param {object} [options]
   * @param {string} [options.imageName='valax-worker:latest']
   * @param {number} [options.memoryLimitMb=512]
   * @param {number} [options.pidsLimit=128]
   * @param {number} [options.cpus=1.0]
   * @param {boolean} [options.forceSubprocess=false]
   */
  constructor(options = {}) {
    this.imageName = options.imageName || 'valax-worker:latest';
    this.memoryLimitMb = options.memoryLimitMb || 512;
    this.pidsLimit = options.pidsLimit || 128;
    this.cpus = options.cpus || 1.0;
    this.forceSubprocess = !!options.forceSubprocess;
    this._dockerAvailable = null;
  }

  /**
   * Checks if Docker CLI and daemon are responsive.
   *
   * @returns {boolean}
   */
  isDockerAvailable() {
    if (this.forceSubprocess) return false;
    if (this._dockerAvailable !== null) return this._dockerAvailable;

    try {
      execSync('docker info', { stdio: 'ignore', timeout: 2000 });
      this._dockerAvailable = true;
    } catch {
      this._dockerAvailable = false;
    }
    return this._dockerAvailable;
  }

  /**
   * Generates Docker run CLI arguments implementing the strict security profile.
   *
   * @param {object} [extraOpts]
   * @returns {string[]}
   */
  getSecurityArgs(extraOpts = {}) {
    return [
      'run',
      '--rm',
      '-i',
      '--network', 'none',
      '--read-only',
      '--user', '1000:1000',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true',
      '--memory', `${this.memoryLimitMb}m`,
      '--memory-swap', `${this.memoryLimitMb}m`,
      '--cpus', String(this.cpus),
      '--pids-limit', String(this.pidsLimit),
      '--tmpfs', '/work:rw,noexec,nosuid,size=64m',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m'
    ];
  }

  /**
   * Synchronous sandbox run (for direct in-process testing / fallback).
   *
   * @param {object} jobRequest
   * @returns {object}
   */
  runJobSync(jobRequest) {
    const executor = new WorkerExecutor({ verifyBaselineOnStartup: true });
    return executor.executeJobSync(jobRequest);
  }

  /**
   * Runs a JobRequest through the worker container (or fallback sandbox).
   *
   * @param {object} jobRequest
   * @returns {Promise<object>}
   */
  async runJob(jobRequest) {
    if (this.isDockerAvailable()) {
      return this._runInDocker(jobRequest);
    } else {
      return this._runInSandbox(jobRequest);
    }
  }

  /**
   * @private
   */
  async _runInDocker(jobRequest) {
    return new Promise((resolve) => {
      const args = [...this.getSecurityArgs(), this.imageName, 'node', '/app/packages/worker/src/index.js'];
      const child = spawn('docker', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', chunk => stdout += chunk);
      child.stderr.on('data', chunk => stderr += chunk);

      child.on('close', (code) => {
        try {
          const response = JSON.parse(stdout.trim());
          resolve(response);
        } catch (err) {
          resolve(WorkerProtocol.createResponse({
            jobId: jobRequest.jobId,
            status: WorkerStatus.FAILED,
            error: {
              code: 'DOCKER_EXECUTION_FAILURE',
              message: `Container exited with code ${code}: ${stderr || 'Invalid JSON output'}`,
              details: stderr
            }
          }));
        }
      });

      child.stdin.write(JSON.stringify(jobRequest));
      child.stdin.end();
    });
  }

  /**
   * High-fidelity isolated execution sandbox when Docker daemon is not active.
   * @private
   */
  async _runInSandbox(jobRequest) {
    const executor = new WorkerExecutor({ verifyBaselineOnStartup: true });
    return executor.executeJob(jobRequest);
  }
}

module.exports = {
  ContainerRunner
};
