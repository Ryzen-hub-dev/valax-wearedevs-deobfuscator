const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { recover } = require('../packages/core/src');

async function testBlindRelease() {
  console.log('=== P0-12 Blind Release Test in Isolated Directory ===\n');

  const blindDir = path.resolve(__dirname, '../scratch/release-blind');
  if (fs.existsSync(blindDir)) {
    fs.rmSync(blindDir, { recursive: true, force: true });
  }
  fs.mkdirSync(blindDir, { recursive: true });

  const fixtureProt = path.resolve(__dirname, '../tests/fixtures/wearedevs/l5w_closed/fixture_10_mixed_closed/protected.lua');
  const blindInput = path.join(blindDir, 'input.lua');
  const blindOutput = path.join(blindDir, 'output.lua');

  // Copy ONLY protected input
  fs.copyFileSync(fixtureProt, blindInput);

  // Read and recover
  const inputCode = fs.readFileSync(blindInput, 'utf8');
  console.log('[1/3] Executing recover() in isolated directory with zero fixture files...');
  const res = recover(inputCode, { stage: 'L5-W', filename: 'input.lua' });

  console.log('Recovery Level:', res.report?.recoveryLevel);
  console.log('Residual States:', res.report?.completeness?.residualStateCount ?? 0);
  console.log('Safe Whole-Program Replacement:', res.report?.completeness?.mixedClosed?.safeWholeProgramReplacement);

  if (res.report?.recoveryLevel !== 'L5-W') {
    throw new Error(`Expected L5-W in blind release test, got: ${res.report?.recoveryLevel}`);
  }

  // Write recovered output
  fs.writeFileSync(blindOutput, res.code, 'utf8');

  // Run with lua
  console.log('[2/3] Executing blind recovered output using lua interpreter...');
  const stdout = execSync(`lua "${blindOutput}"`, { encoding: 'utf8' }).trim();
  console.log('Lua stdout:\n' + stdout);

  const expectedStdout = ['hi', 'one', 'x', 'hi', 'two', 'y'].join('\n');
  const match = (stdout.replace(/\r\n/g, '\n') === expectedStdout);
  console.log('Matches expected stdout:', match);

  if (!match) {
    throw new Error(`Stdout mismatch! Got:\n${stdout}\nExpected:\n${expectedStdout}`);
  }

  console.log('\n>>> P0-12 BLIND RELEASE TEST PASSED: Full standalone deobfuscation and execution verified!');
}

testBlindRelease().catch(err => {
  console.error('P0-12 Failure:', err);
  process.exit(1);
});
