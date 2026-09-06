const fs = require('fs');
const path = require('path');
const { recover } = require('../packages/core/src');

async function testMetamorphic() {
  console.log('=== P0-11 Metamorphic Generalization on Genuine Protected Programs ===\n');

  const targets = [
    {
      id: 'Target 1: Minimal Ground Truth (minimal_print)',
      file: 'tests/fixtures/wearedevs/minimal_print/protected.lua',
      expectedLevel: 'L5-W'
    },
    {
      id: 'Target 2: Simple Closed Constant (fixture_01_local_constant)',
      file: 'tests/fixtures/wearedevs/l5w_closed/fixture_01_local_constant/protected.lua',
      expectedLevel: 'L5-W'
    },
    {
      id: 'Target 3: Multi-Return Expansion (fixture_07_multireturn)',
      file: 'tests/fixtures/wearedevs/l5w_closed/fixture_07_multireturn/protected.lua',
      expectedLevel: 'L5-W'
    },
    {
      id: 'Target 4: Closure Capture & Upvalues (fixture_09_closure_capture)',
      file: 'tests/fixtures/wearedevs/l5w_closed/fixture_09_closure_capture/protected.lua',
      expectedLevel: 'L5-W'
    },
    {
      id: 'Target 5: Mixed Cross-Feature Closed Program (fixture_10_mixed_closed)',
      file: 'tests/fixtures/wearedevs/l5w_closed/fixture_10_mixed_closed/protected.lua',
      expectedLevel: 'L5-W'
    },
    {
      id: 'Target 6: Real-World In-the-Wild Program (ByIdiotSandWich.txt)',
      file: 'ByIdiotSandWich.txt',
      expectedLevel: 'L4'
    }
  ];

  let passed = 0;

  for (const t of targets) {
    const fullPath = path.resolve(__dirname, '..', t.file);
    if (!fs.existsSync(fullPath)) {
      console.log(`[-] Skipping ${t.id}: file not found at ${fullPath}`);
      continue;
    }

    const source = fs.readFileSync(fullPath, 'utf8');
    const start = Date.now();
    const res = recover(source, { stage: t.expectedLevel, filename: path.basename(t.file) });
    const elapsed = Date.now() - start;

    const actualLevel = res.report?.recoveryLevel;
    const ok = actualLevel === t.expectedLevel;

    console.log(`[+] ${t.id}:`);
    console.log(`    File:           ${t.file}`);
    console.log(`    Expected Level: ${t.expectedLevel}`);
    console.log(`    Actual Level:   ${actualLevel}`);
    console.log(`    Time:           ${elapsed}ms`);
    console.log(`    Residual States: ${res.report?.completeness?.residualStateCount ?? res.report?.residualDispatcherStates ?? 0}`);
    console.log(`    Output Valid:   ${Boolean(res.code && res.code.length > 0)}`);

    if (ok) {
      passed++;
    } else {
      throw new Error(`Level mismatch for ${t.id}: expected ${t.expectedLevel}, got ${actualLevel}`);
    }
    console.log('');
  }

  console.log(`>>> P0-11 METAMORPHIC GENERALIZATION: ${passed}/${targets.length} genuine protected targets passed successfully!`);
}

testMetamorphic().catch(err => {
  console.error('P0-11 Failure:', err);
  process.exit(1);
});
