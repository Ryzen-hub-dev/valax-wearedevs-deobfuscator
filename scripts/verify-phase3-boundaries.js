/**
 * Phase 3 Architecture Boundary Scanner:
 * Verifies that product-facing components (apps/web, packages/api, packages/discord)
 * do not import forbidden internal modules (packages/core, packages/worker, ContainerRunner, direct Docker).
 *
 * Saves results to audit/phase3-boundary-import-scan.json.
 * Exits with status 1 on violation.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AUDIT_OUT = path.join(ROOT, 'audit/phase3-boundary-import-scan.json');

const FORBIDDEN_RULES = [
  {
    targetDir: 'apps/web',
    forbiddenPatterns: [
      { pattern: /packages\/core/i, reason: 'apps/web must never import packages/core' },
      { pattern: /@valax\/core/i, reason: 'apps/web must never import @valax/core' },
      { pattern: /packages\/worker/i, reason: 'apps/web must never import packages/worker' },
      { pattern: /@valax\/worker/i, reason: 'apps/web must never import @valax/worker' },
      { pattern: /ContainerRunner/i, reason: 'apps/web must never reference ContainerRunner' },
      { pattern: /RecoveryService/i, reason: 'apps/web must never reference RecoveryService' },
      { pattern: /require\(['"]child_process['"]\)/i, reason: 'apps/web must never invoke child processes / docker' }
    ]
  },
  {
    targetDir: 'packages/api',
    forbiddenPatterns: [
      { pattern: /packages\/core/i, reason: 'packages/api must never import packages/core' },
      { pattern: /@valax\/core/i, reason: 'packages/api must never import @valax/core' },
      { pattern: /ContainerRunner/i, reason: 'packages/api must never reference ContainerRunner directly' },
      { pattern: /packages\/worker\/src\/(worker-executor|container-runner|protocol)/i, reason: 'packages/api must not import worker internals' },
      { pattern: /docker/i, reason: 'packages/api must not reference Docker commands directly' }
    ]
  },
  {
    targetDir: 'packages/discord',
    forbiddenPatterns: [
      { pattern: /packages\/core/i, reason: 'packages/discord must never import packages/core' },
      { pattern: /@valax\/core/i, reason: 'packages/discord must never import @valax/core' },
      { pattern: /packages\/worker/i, reason: 'packages/discord must never import packages/worker' },
      { pattern: /ContainerRunner/i, reason: 'packages/discord must never reference ContainerRunner' },
      { pattern: /docker/i, reason: 'packages/discord must not invoke Docker commands directly' }
    ]
  }
];

function getAllFiles(dirPath, arrayOfFiles = []) {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        getAllFiles(fullPath, arrayOfFiles);
      }
    } else {
      if (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.html')) {
        arrayOfFiles.push(fullPath);
      }
    }
  }

  return arrayOfFiles;
}

function runBoundaryScan() {
  console.log('=== PHASE 3 ARCHITECTURE BOUNDARY SCANNER ===');
  const violations = [];
  const scannedFiles = [];

  for (const ruleGroup of FORBIDDEN_RULES) {
    const targetDirAbs = path.join(ROOT, ruleGroup.targetDir);
    if (!fs.existsSync(targetDirAbs)) {
      console.log(`Directory ${ruleGroup.targetDir} not found, skipping.`);
      continue;
    }

    const files = getAllFiles(targetDirAbs);
    for (const file of files) {
      const relPath = path.relative(ROOT, file).replace(/\\/g, '/');
      scannedFiles.push(relPath);
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split(/\r?\n/);

      let inBlockComment = false;
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('/*')) inBlockComment = true;
        if (inBlockComment) {
          if (trimmed.endsWith('*/') || trimmed.includes('*/')) inBlockComment = false;
          return;
        }
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

        for (const rule of ruleGroup.forbiddenPatterns) {
          if (rule.pattern.test(line)) {
            violations.push({
              file: relPath,
              line: idx + 1,
              matchedRule: rule.reason,
              snippet: line.trim()
            });
          }
        }
      });
    }
  }

  const pass = violations.length === 0;
  const result = {
    timestamp: new Date().toISOString(),
    status: pass ? 'BOUNDARY_VERIFICATION_PASS' : 'BOUNDARY_VIOLATIONS_DETECTED',
    totalFilesScanned: scannedFiles.length,
    scannedFiles,
    violationCount: violations.length,
    violations,
    pass
  };

  fs.mkdirSync(path.dirname(AUDIT_OUT), { recursive: true });
  fs.writeFileSync(AUDIT_OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log(`Total files scanned: ${scannedFiles.length}`);
  console.log(`Violations found: ${violations.length}`);
  console.log(`Audit saved to ${AUDIT_OUT}`);

  if (!pass) {
    console.error('\nFATAL: Architecture boundary violations detected!');
    violations.forEach(v => {
      console.error(`  - ${v.file}:${v.line} -> ${v.matchedRule} ("${v.snippet}")`);
    });
    process.exit(1);
  } else {
    console.log('✔ All product boundaries strictly enforced. Zero forbidden imports found.');
  }
}

if (require.main === module) {
  runBoundaryScan();
}

module.exports = { runBoundaryScan };
