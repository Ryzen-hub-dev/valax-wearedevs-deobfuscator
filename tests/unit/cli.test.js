const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { describe, test } = require('../test-framework');
const { runCli, ExitCode } = require('../../packages/cli/src');

function runCliTests() {
  describe('Valax Production CLI Test Suite', () => {

    // Helper to capture CLI execution in-process
    function execCli(args) {
      let stdoutStr = '';
      let stderrStr = '';
      let exitCode = null;

      const io = {
        stdout: (s) => { stdoutStr += s; },
        stderr: (s) => { stderrStr += s; },
        exit: (code) => { exitCode = code; }
      };

      runCli(args, io);

      return { stdout: stdoutStr, stderr: stderrStr, exitCode };
    }

    // 1. --help and --version
    test('1. CLI flags --help and --version display info with exit 0', () => {
      const helpRes = execCli(['--help']);
      assert.strictEqual(helpRes.exitCode, ExitCode.SUCCESS);
      assert(helpRes.stdout.includes('Usage:'));
      assert(helpRes.stdout.includes('valax-recover'));

      const verRes = execCli(['--version']);
      assert.strictEqual(verRes.exitCode, ExitCode.SUCCESS);
      assert(verRes.stdout.includes('0.1.0-beta.1'));
    });

    // 2. Missing input argument
    test('2. Missing input file returns ExitCode 2 (INVALID_ARGUMENTS)', () => {
      const res = execCli([]);
      assert.strictEqual(res.exitCode, ExitCode.INVALID_ARGUMENTS);
      assert(res.stderr.includes('No input file specified'));
    });

    // 3. Non-existent file
    test('3. Non-existent file returns ExitCode 2 (INVALID_ARGUMENTS)', () => {
      const res = execCli(['non_existent_file_xyz_12345.lua']);
      assert.strictEqual(res.exitCode, ExitCode.INVALID_ARGUMENTS);
      assert(res.stderr.includes('Input file does not exist'));
    });

    // 4. Directory passed instead of file
    test('4. Directory passed as input returns ExitCode 2 (INVALID_ARGUMENTS)', () => {
      const res = execCli(['tests']);
      assert.strictEqual(res.exitCode, ExitCode.INVALID_ARGUMENTS);
      assert(res.stderr.includes('not a regular file'));
    });

    // 5. Strict rejection of forbidden bypass flags
    test('5. Rejection of forbidden bypass flags (--force-l5w, --ignore-proof-failure, --unsafe-prune)', () => {
      const flags = ['--force-l5w', '--ignore-proof-failure', '--unsafe-prune', '--bypass-gates'];
      const inputFixture = path.resolve(__dirname, '../fixtures/wearedevs/l5w_closed/fixture_01_local_constant/protected.lua');
      for (const flag of flags) {
        const res = execCli([inputFixture, flag]);
        assert.strictEqual(res.exitCode, ExitCode.INVALID_ARGUMENTS, `Must reject ${flag}`);
        assert(res.stderr.includes('strictly prohibited'), `Must warn about prohibited bypass for ${flag}`);
      }
    });

    // 6. Binary bytecode input
    test('6. Binary bytecode input returns ExitCode 4 (UNRECOGNIZED_FORMAT)', () => {
      const tmpFile = path.join(os.tmpdir(), `test_binary_${Date.now()}.luac`);
      fs.writeFileSync(tmpFile, '\x1bLua\x51\x00\x01\x04\x08', 'utf8');
      try {
        const res = execCli([tmpFile]);
        assert.strictEqual(res.exitCode, ExitCode.UNRECOGNIZED_FORMAT);
        assert(res.stderr.includes('compiled bytecode is not supported'));
      } finally {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
      }
    });

    // 7. Syntax parse error on malformed Lua
    test('7. Malformed syntax returns ExitCode 3 (PARSE_FAILURE)', () => {
      const tmpFile = path.join(os.tmpdir(), `test_malformed_${Date.now()}.lua`);
      fs.writeFileSync(tmpFile, 'function broken( syntax error here !!!', 'utf8');
      try {
        const res = execCli([tmpFile]);
        assert.strictEqual(res.exitCode, ExitCode.PARSE_FAILURE);
      } finally {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
      }
    });

    // 8. Human mode successful recovery on closed fixture
    test('8. Human mode execution on closed fixture produces clean output and report', () => {
      const inputFixture = path.resolve(__dirname, '../fixtures/wearedevs/l5w_closed/fixture_01_local_constant/protected.lua');
      const outCode = path.join(os.tmpdir(), `cli_out_${Date.now()}.lua`);
      const outReport = path.join(os.tmpdir(), `cli_rep_${Date.now()}.json`);

      try {
        const res = execCli([inputFixture, '--output', outCode, '--report', outReport]);
        assert.strictEqual(res.exitCode, ExitCode.SUCCESS);
        assert(res.stdout.includes('Input:'));
        assert(res.stdout.includes('Recovery Level: L5-W') || res.stdout.includes('Recovery Level: L4'));
        assert(fs.existsSync(outCode), 'Recovered file must be written');
        assert(fs.existsSync(outReport), 'Report file must be written');

        const repJson = JSON.parse(fs.readFileSync(outReport, 'utf8'));
        assert.strictEqual(repJson.schemaVersion, '1');
        assert.strictEqual(repJson.toolVersion, '0.1.0-beta.1');
        assert(['L5-W', 'L4'].includes(repJson.recovery.actualLevel), `Expected L5-W or L4, got ${repJson.recovery.actualLevel}`);
      } finally {
        try { fs.unlinkSync(outCode); } catch (_) {}
        try { fs.unlinkSync(outReport); } catch (_) {}
      }
    });

    // 9. JSON mode output contract
    test('9. JSON mode outputs pure machine-readable JSON to stdout', () => {
      const inputFixture = path.resolve(__dirname, '../fixtures/wearedevs/l5w_closed/fixture_01_local_constant/protected.lua');
      const outCode = path.join(os.tmpdir(), `cli_out_json_${Date.now()}.lua`);
      const outReport = path.join(os.tmpdir(), `cli_rep_json_${Date.now()}.json`);

      try {
        const res = execCli([inputFixture, '--json', '--output', outCode, '--report', outReport]);
        assert.strictEqual(res.exitCode, ExitCode.SUCCESS);

        // stdout must be strictly valid JSON without preamble
        const parsed = JSON.parse(res.stdout);
        assert.strictEqual(parsed.schemaVersion, '1');
        assert.strictEqual(parsed.toolVersion, '0.1.0-beta.1');
        assert.strictEqual(parsed.status, 'success');
        assert(['L5-W', 'L4'].includes(parsed.recovery.actualLevel), `Expected L5-W or L4, got ${parsed.recovery.actualLevel}`);
        assert.strictEqual(parsed.outputs.code, outCode);
        assert.strictEqual(parsed.outputs.report, outReport);
      } finally {
        try { fs.unlinkSync(outCode); } catch (_) {}
        try { fs.unlinkSync(outReport); } catch (_) {}
      }
    });

    // 10. Conservative L4 downgrade returns exit code 0
    test('10. Conservative L4 downgrade completes with ExitCode 0', () => {
      const inputFixture = path.resolve(__dirname, '../../ByIdiotSandWich.txt');
      const outCode = path.join(os.tmpdir(), `cli_out_l4_${Date.now()}.lua`);
      const outReport = path.join(os.tmpdir(), `cli_rep_l4_${Date.now()}.json`);

      try {
        const res = execCli([inputFixture, '--stage', 'auto', '--no-semantic-validation', '--output', outCode, '--report', outReport]);
        assert.strictEqual(res.exitCode, ExitCode.SUCCESS, 'Conservative downgrade is not an error; must exit 0');
        assert(res.stdout.includes('Recovery Level: L4'));
        assert(res.stdout.includes('Residual Dispatcher States:'));
      } finally {
        try { fs.unlinkSync(outCode); } catch (_) {}
        try { fs.unlinkSync(outReport); } catch (_) {}
      }
    });

    // 11. Windows compatibility: Paths with spaces and Unicode filenames
    test('11. Windows path handling: paths with spaces and unicode names', () => {
      const testDir = path.join(os.tmpdir(), 'valax test dir with spaces');
      if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

      const unicodeFile = path.join(testDir, '测试_script_αβ.lua');
      fs.writeFileSync(unicodeFile, 'local a = 1; print(a)', 'utf8');

      const outCode = path.join(testDir, 'output with space.lua');
      const outReport = path.join(testDir, 'report with space.json');

      try {
        const res = execCli([unicodeFile, '--output', outCode, '--report', outReport]);
        assert.strictEqual(res.exitCode, ExitCode.SUCCESS);
        assert(fs.existsSync(outCode));
        assert(fs.existsSync(outReport));
      } finally {
        try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
      }
    });

    // 12. Output write failure simulation returns ExitCode 8
    test('12. Output write failure returns ExitCode 8 (OUTPUT_WRITE_FAILURE)', () => {
      const inputFixture = path.resolve(__dirname, '../fixtures/wearedevs/l5w_closed/fixture_01_local_constant/protected.lua');
      // Target directory that cannot exist across all OSes (attempting to create file inside a regular file)
      const invalidOutCode = path.join(__dirname, '../../package.json/invalid_dir/out.lua');

      const res = execCli([inputFixture, '--output', invalidOutCode]);
      assert.strictEqual(res.exitCode, ExitCode.OUTPUT_WRITE_FAILURE);
      assert(res.stderr.includes('Error writing recovered output file'));
    });

  });
}

module.exports = { runCliTests };

if (require.main === module) {
  const { printSummary } = require('../test-framework');
  runCliTests();
  printSummary();
}
