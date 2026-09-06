/**
 * IsolatedRunner:
 * Secure, resource-bounded runner for executing untrusted Lua/Luau scripts
 * during semantic differential validation.
 *
 * Enforces:
 * - Wall-clock timeout enforcement (default <= 5000ms) with process termination
 * - Output buffer limit enforcement (default <= 1 MiB stdout / stderr) -> OUTPUT_LIMIT_EXCEEDED
 * - Working directory isolation: executed inside isolated temporary directory, cleaned up after execution
 * - Environment variable allowlist: strips secrets, tokens, API keys, private paths
 * - Platform capability reporting: networkIsolation and memoryIsolation explicitly declared
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MiB
const ALLOWED_ENV_VARS = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'TEMP',
  'TMP',
  'COMSPEC',
  'NODE_ENV'
];

class IsolatedRunner {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES;
    this.luaBinary = options.luaBinary || this.findLuaBinary();
  }

  /**
   * Discovers available Lua/LuaJIT binary in system PATH.
   */
  findLuaBinary() {
    const candidates = ['luajit', 'lua', 'lua5.1', 'lua5.3', 'lua5.4'];
    for (const bin of candidates) {
      try {
        const r = spawnSync(bin, ['-v'], { encoding: 'utf8', timeout: 500 });
        if (r.status === 0 || r.stdout || r.stderr) {
          return bin;
        }
      } catch (e) {
        // Candidate not available
      }
    }
    return null;
  }

  /**
   * Constructs a sanitized environment variable map containing only allowlisted keys.
   */
  createSanitizedEnv() {
    const sanitized = {};
    for (const key of ALLOWED_ENV_VARS) {
      // Case-insensitive lookup for Windows compatibility
      const matchedKey = Object.keys(process.env).find(k => k.toUpperCase() === key.toUpperCase());
      if (matchedKey && process.env[matchedKey] !== undefined) {
        sanitized[key] = process.env[matchedKey];
      }
    }
    return sanitized;
  }

  /**
   * Returns current sandbox capability report.
   */
  getCapabilities() {
    return {
      filesystemIsolation: 'isolated-temp-cwd',
      environmentSanitization: 'allowlist',
      timeoutEnforcement: 'process-kill',
      outputLimitEnforcement: 'max-buffer-kill',
      // Explicitly honest: Windows process runner does not provide kernel containerization
      networkIsolation: 'unavailable',
      memoryIsolation: 'unavailable'
    };
  }

  /**
   * Executes a Lua source snippet in an isolated sandbox directory.
   *
   * @param {object} params
   * @param {string} params.source Lua code to execute
   * @param {string} [params.harnessSource] Optional harness code wrapping execution
   * @param {Array<string>} [params.args] Additional CLI arguments for Lua
   * @param {number} [params.timeoutMs] Override timeout
   * @param {number} [params.maxOutputBytes] Override output limit
   * @param {object} [params.syntheticEnv] Synthetic environment variables passed to harness
   * @returns {{ success: boolean, stdout: string, stderr: string, code: number|null, reason?: string, isolatedDir?: string }}
   */
  run({
    source,
    harnessSource = null,
    args = [],
    timeoutMs = null,
    maxOutputBytes = null
  }) {
    if (!this.luaBinary) {
      return {
        success: false,
        stdout: '',
        stderr: 'No Lua/LuaJIT executable found in PATH',
        code: 1,
        reason: 'NO_LUA_BINARY'
      };
    }

    const timeout = timeoutMs || this.timeoutMs;
    const maxBuffer = maxOutputBytes || this.maxOutputBytes;

    // 1. Create unique isolated temporary working directory
    const prefix = path.join(os.tmpdir(), 'valax-sandbox-');
    const isolatedDir = fs.mkdtempSync(prefix);

    const scriptFile = path.join(isolatedDir, 'target.lua');
    const harnessFile = harnessSource ? path.join(isolatedDir, 'harness.lua') : null;

    try {
      fs.writeFileSync(scriptFile, source, 'utf8');
      if (harnessFile && harnessSource) {
        fs.writeFileSync(harnessFile, harnessSource, 'utf8');
      }

      // 2. Prepare command arguments and isolated cwd
      const runTarget = harnessFile ? harnessFile : scriptFile;
      const targetArgs = harnessFile ? [harnessFile, scriptFile, ...args] : [scriptFile, ...args];

      // 3. Prepare sanitized environment
      const env = this.createSanitizedEnv();

      // 4. Execute with strict limits
      const res = spawnSync(this.luaBinary, targetArgs, {
        cwd: isolatedDir,
        env: env,
        timeout: timeout,
        maxBuffer: maxBuffer,
        encoding: 'utf8',
        killSignal: 'SIGKILL'
      });

      // 5. Check execution outcomes
      if (res.error) {
        if (res.error.code === 'ETIMEDOUT' || res.error.message?.includes('TIMEDOUT')) {
          return {
            success: false,
            stdout: res.stdout || '',
            stderr: res.stderr || 'Execution timed out',
            code: null,
            reason: 'TIMEOUT'
          };
        }
        if (res.error.code === 'ENOBUFS' || res.error.message?.includes('maxBuffer')) {
          return {
            success: false,
            stdout: res.stdout || '',
            stderr: 'Output limit exceeded',
            code: null,
            reason: 'OUTPUT_LIMIT_EXCEEDED'
          };
        }
        return {
          success: false,
          stdout: res.stdout || '',
          stderr: res.error.message,
          code: res.status,
          reason: res.error.code || 'SPAWN_ERROR'
        };
      }

      // Manual check on output length in case maxBuffer didn't trigger
      if (res.stdout && Buffer.byteLength(res.stdout, 'utf8') > maxBuffer) {
        return {
          success: false,
          stdout: res.stdout.slice(0, 1000),
          stderr: 'Output limit exceeded',
          code: null,
          reason: 'OUTPUT_LIMIT_EXCEEDED'
        };
      }

      return {
        success: res.status === 0,
        stdout: res.stdout || '',
        stderr: res.stderr || '',
        code: res.status,
        reason: res.status === 0 ? null : (res.stderr || `EXIT_CODE_${res.status}`)
      };
    } finally {
      // 6. Cleanup isolated temporary working directory completely
      try {
        fs.rmSync(isolatedDir, { recursive: true, force: true });
      } catch (_) {
        // Best effort cleanup
      }
    }
  }
}

module.exports = {
  IsolatedRunner,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  ALLOWED_ENV_VARS
};
