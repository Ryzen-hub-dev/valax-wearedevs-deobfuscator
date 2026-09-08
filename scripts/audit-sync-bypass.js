/**
 * Sync Recovery Execution Bypass Audit:
 * Verifies that tests/integration/product-real-container-e2e.test.js contains strictly
 * ZERO occurrences of synchronous recovery bypasses:
 * - processNextJobSync
 * - submitJobSync
 * - direct RecoveryService occurrences
 * - inMemoryQueue / InMemoryJobQueue occurrences
 * - mockExecution occurrences
 *
 * Emits audit/phase3-sync-bypass-audit.json
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

function runSyncBypassAudit() {
  console.log('\n=== Auditing Sync Recovery Execution Bypasses in Real Product E2E ===');

  const targetFile = path.resolve(__dirname, '../tests/integration/product-real-container-e2e.test.js');
  if (!fs.existsSync(targetFile)) {
    throw new Error(`Target test file does not exist: ${targetFile}`);
  }

  const content = fs.readFileSync(targetFile, 'utf8');

  const prohibitedPatterns = [
    { name: 'processNextJobSync', regex: /\bprocessNextJobSync\b/g },
    { name: 'submitJobSync', regex: /\bsubmitJobSync\b/g },
    { name: 'direct RecoveryService', regex: /\bRecoveryService\b/g },
    { name: 'inMemoryQueue / InMemoryJobQueue', regex: /\bInMemoryJobQueue\b/g },
    { name: 'mockExecution', regex: /\bmockExecution\b/gi }
  ];

  const violations = [];
  const patternCounts = {};

  for (const { name, regex } of prohibitedPatterns) {
    const matches = content.match(regex);
    const count = matches ? matches.length : 0;
    patternCounts[name] = count;
    if (count > 0) {
      violations.push({ pattern: name, count });
    }
  }

  const auditReport = {
    auditName: 'SYNC_RECOVERY_EXECUTION_BYPASS_AUDIT',
    timestamp: new Date().toISOString(),
    targetFile: 'tests/integration/product-real-container-e2e.test.js',
    prohibitedPatternsChecked: patternCounts,
    violationsCount: violations.length,
    violations,
    passed: violations.length === 0,
    verdict: violations.length === 0 ? 'ZERO_SYNC_BYPASS_VERIFIED' : 'SYNC_BYPASS_DETECTED'
  };

  const auditDir = path.resolve(__dirname, '../audit');
  if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });

  const auditPath = path.join(auditDir, 'phase3-sync-bypass-audit.json');
  fs.writeFileSync(auditPath, JSON.stringify(auditReport, null, 2), 'utf8');

  console.log(`Audited: ${targetFile}`);
  for (const [name, count] of Object.entries(patternCounts)) {
    console.log(`  Pattern '${name}': ${count} occurrences`);
  }

  if (violations.length > 0) {
    console.error(`\n[FAIL] Found ${violations.length} prohibited synchronous bypasses!`);
    process.exit(1);
  }

  console.log('\n[PASS] Zero synchronous bypasses detected in product-real-container-e2e.test.js');
  console.log(`Report written to: ${auditPath}\n`);
}

if (require.main === module) {
  runSyncBypassAudit();
}

module.exports = { runSyncBypassAudit };
