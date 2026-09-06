const fs = require('fs');
const path = require('path');
const { recover } = require('../packages/core/src');

async function testIsolation() {
  console.log('=== P0-4 Fixture Isolation & Blind Execution Guard ===');

  const fixtureDir = path.resolve(__dirname, '../tests/fixtures/wearedevs/l5w_closed/fixture_10_mixed_closed');
  const origPath = path.join(fixtureDir, 'original.lua');
  const expPath = path.join(fixtureDir, 'expected.lua');
  const metaPath = path.join(fixtureDir, 'metadata.json');
  const protPath = path.join(fixtureDir, 'protected.lua');

  const origHidden = origPath + '.hidden';
  const expHidden = expPath + '.hidden';
  const metaHidden = metaPath + '.hidden';

  // 1. Rename files to .hidden
  if (fs.existsSync(origPath)) fs.renameSync(origPath, origHidden);
  if (fs.existsSync(expPath)) fs.renameSync(expPath, expHidden);
  if (fs.existsSync(metaPath)) fs.renameSync(metaPath, metaHidden);

  try {
    console.log('[1/3] Running pipeline on fixture_10 with all auxiliary files hidden (.hidden)...');
    const protCode = fs.readFileSync(protPath, 'utf8');
    const res1 = recover(protCode, { stage: 'L5-W', filename: 'protected.lua' });

    console.log('Result 1 recovery level:', res1.report?.recoveryLevel);
    console.log('Result 1 safeWholeProgramReplacement:', res1.report?.completeness?.mixedClosed?.safeWholeProgramReplacement);
    console.log('Result 1 isL5WEligible:', res1.report?.completeness?.isL5WEligible);

    // 2. Run on outside file
    console.log('[2/3] Running pipeline on isolated external path scratch/random_input_8472.lua...');
    const scratchDir = path.resolve(__dirname, '../scratch');
    if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
    const randomPath = path.join(scratchDir, 'random_input_8472.lua');
    fs.writeFileSync(randomPath, protCode, 'utf8');

    const res2 = recover(protCode, { stage: 'L5-W', filename: 'random_input_8472.lua' });

    console.log('Result 2 recovery level:', res2.report?.recoveryLevel);
    console.log('Result 2 safeWholeProgramReplacement:', res2.report?.completeness?.mixedClosed?.safeWholeProgramReplacement);
    console.log('Result 2 isL5WEligible:', res2.report?.completeness?.isL5WEligible);

    // Verify identity
    const code1 = res1.code;
    const code2 = res2.code;
    const match = (code1 === code2);
    console.log('Identical output between fixture and external isolated run:', match);
    if (!match) {
      throw new Error('Outputs did not match!');
    }
    if (res1.report?.recoveryLevel !== 'L5-W') {
      throw new Error(`Expected L5-W, got ${res1.report?.recoveryLevel}`);
    }

    console.log('>>> P0-4 ISOLATION TEST PASSED: Recovery operates purely on protected.lua bytecode/AST without any side-channel leakage!');
  } finally {
    // Restore files
    if (fs.existsSync(origHidden)) fs.renameSync(origHidden, origPath);
    if (fs.existsSync(expHidden)) fs.renameSync(expHidden, expPath);
    if (fs.existsSync(metaHidden)) fs.renameSync(metaHidden, metaPath);
    console.log('[3/3] Auxiliary fixture files restored.');
  }
}

testIsolation().catch(err => {
  console.error('P0-4 Failure:', err);
  process.exit(1);
});
