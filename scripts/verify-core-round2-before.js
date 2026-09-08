const fs = require('fs');
const path = require('path');
const { CoreBaselineGuard } = require('../packages/worker/src/core-baseline-guard');

const guard = new CoreBaselineGuard();
const result = guard.verify();

console.log('Core Baseline Verification:');
console.log('  Baseline Tag:', result.baselineTag);
console.log('  Total Checked:', result.totalChecked);
console.log('  Verified:', result.verified);
console.log('  Mismatches:', result.mismatches.length);

if (!result.verified) {
  console.error('CORE_BASELINE_VIOLATION:');
  console.error(JSON.stringify(result.mismatches, null, 2));
  process.exit(1);
}

const auditOutput = {
  verified: result.verified,
  baselineTag: result.baselineTag,
  frozenAt: result.frozenAt,
  totalChecked: result.totalChecked,
  mismatches: result.mismatches,
  timestamp: new Date().toISOString(),
  phase: 'PHASE_3_ROUND_2_BEFORE',
  frozenCoreStatus: 'FROZEN_100_PERCENT_INTACT'
};

const targetFile = process.argv[2] || path.resolve(__dirname, '../audit/phase3-round2-core-before.json');
fs.writeFileSync(targetFile, JSON.stringify(auditOutput, null, 2) + '\n');
console.log(`Successfully written: ${targetFile}`);
