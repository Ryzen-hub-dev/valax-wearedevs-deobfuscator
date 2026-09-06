const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { describe, test } = require('../test-framework');
const { IsolatedRunner } = require('../../packages/sandbox/src');

function runSandboxTests() {
  describe('Adversarial & Resource-Limit Sandbox Test Suite', () => {
    const runner = new IsolatedRunner();

    if (!runner.luaBinary) {
      test('Sandbox requires Lua/LuaJIT binary (skipped if absent)', () => {
        console.log('    [SKIP] No Lua binary found on host system');
      });
      return;
    }

    // 1. Timeout enforcement on infinite loop
    test('1. Infinite loop terminates with TIMEOUT and process kill', () => {
      const infiniteLoopCode = `
        local count = 0
        while true do
          count = count + 1
        end
      `;

      const start = Date.now();
      const res = runner.run({
        source: infiniteLoopCode,
        timeoutMs: 1500 // short timeout for test speed
      });
      const elapsed = Date.now() - start;

      assert.strictEqual(res.success, false, 'Infinite loop must fail');
      assert.strictEqual(res.reason, 'TIMEOUT', `Reason must be TIMEOUT, got: ${res.reason}`);
      assert(elapsed >= 1400, `Elapsed time must be around timeout, took ${elapsed}ms`);
      assert(elapsed < 4000, `Process must be killed promptly, took ${elapsed}ms`);
    });

    // 2. Output buffer limit enforcement on flood output
    test('2. Massive output flood terminates with OUTPUT_LIMIT_EXCEEDED', () => {
      const floodCode = `
        local chunk = string.rep("0123456789ABCDEF", 1024) -- 16 KB
        for i = 1, 1000 do -- 16 MB total attempt
          io.stdout:write(chunk)
        end
      `;

      const res = runner.run({
        source: floodCode,
        maxOutputBytes: 64 * 1024, // 64 KB limit for test speed
        timeoutMs: 5000
      });

      assert.strictEqual(res.success, false, 'Output flood must fail');
      assert.strictEqual(res.reason, 'OUTPUT_LIMIT_EXCEEDED', `Reason must be OUTPUT_LIMIT_EXCEEDED, got: ${res.reason}`);
    });

    // 3. Environment sanitization: parent secret must NOT leak to child process
    test('3. Child process environment is sanitized (no secret env leaks)', () => {
      const secretKey = 'VALAX_SECRET_AUTH_TOKEN_TEST';
      const secretVal = 'sk-valax-ultra-secret-test-key-9988';
      process.env[secretKey] = secretVal;

      try {
        const probeCode = `
          local secret = os.getenv("${secretKey}")
          if secret and secret ~= "" then
            io.stdout:write("SECRET_FOUND:" .. secret .. "\\n")
          else
            io.stdout:write("ENV_CLEAN\\n")
          end
        `;

        const res = runner.run({ source: probeCode });
        assert.strictEqual(res.success, true);
        assert(res.stdout.includes('ENV_CLEAN'), `Environment must be sanitized. Output was: ${res.stdout}`);
        assert.strictEqual(res.stdout.includes(secretVal), false, 'Child process must not see secret token');
      } finally {
        delete process.env[secretKey];
      }
    });

    // 4. Working directory isolation: child process cwd is an isolated temp dir, not host project dir
    test('4. Working directory is isolated temporary directory', () => {
      const cwdProbeCode = `
        local f = io.open("test_marker.tmp", "w")
        if f then
          f:write("isolated")
          f:close()
        end
        io.stdout:write("MARKER_WRITTEN\\n")
      `;

      const projectMarker = path.join(process.cwd(), 'test_marker.tmp');
      if (fs.existsSync(projectMarker)) {
        fs.unlinkSync(projectMarker);
      }

      const res = runner.run({ source: cwdProbeCode });
      assert.strictEqual(res.success, true);
      assert(res.stdout.includes('MARKER_WRITTEN'));

      // The marker file must NOT exist in the host project directory
      assert.strictEqual(fs.existsSync(projectMarker), false, 'Child file must not be created in host project root');
    });

    // 5. Capability disclosure: network and memory isolation declared as unavailable
    test('5. Sandbox reports platform capabilities honestly without false claims', () => {
      const caps = runner.getCapabilities();
      assert.strictEqual(caps.filesystemIsolation, 'isolated-temp-cwd');
      assert.strictEqual(caps.environmentSanitization, 'allowlist');
      assert.strictEqual(caps.timeoutEnforcement, 'process-kill');
      assert.strictEqual(caps.outputLimitEnforcement, 'max-buffer-kill');
      assert.strictEqual(caps.networkIsolation, 'unavailable', 'Windows local runner must report networkIsolation unavailable');
      assert.strictEqual(caps.memoryIsolation, 'unavailable', 'Windows local runner must report memoryIsolation unavailable');
    });

  });
}

module.exports = { runSandboxTests };

if (require.main === module) {
  const { printSummary } = require('../test-framework');
  runSandboxTests();
  printSummary();
}
