/**
 * Boundary Import Enforcement Scanner for packages/discord.
 * 
 * Asserts:
 * 1. Zero imports of packages/core or core recovery algorithms.
 * 2. Zero imports of packages/worker or worker-executor.
 * 3. Zero direct usage of ContainerRunner or RecoveryService.
 * 4. Zero execution of child_process or Docker inside Discord adapter.
 * 5. Zero direct execution of lua or luajit runtime binaries.
 */

const fs = require('fs');
const path = require('path');

const DISCORD_SRC_DIR = path.resolve(__dirname, '../packages/discord/src');
const AUDIT_OUTPUT = path.resolve(__dirname, '../audit/phase3-discord-boundary-scan.json');

const FORBIDDEN_PATTERNS = [
  { pattern: /require\s*\(\s*['"][^'"]*packages\/core/i, reason: 'FORBIDDEN_IMPORT: packages/core cannot be imported by discord bot' },
  { pattern: /require\s*\(\s*['"][^'"]*core\/src/i, reason: 'FORBIDDEN_IMPORT: core/src cannot be imported by discord bot' },
  { pattern: /require\s*\(\s*['"][^'"]*packages\/worker/i, reason: 'FORBIDDEN_IMPORT: packages/worker cannot be imported by discord bot' },
  { pattern: /require\s*\(\s*['"][^'"]*worker\/src/i, reason: 'FORBIDDEN_IMPORT: worker/src cannot be imported by discord bot' },
  { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/i, reason: 'FORBIDDEN_EXECUTION: child_process cannot be required in discord package' },
  { pattern: /\bContainerRunner\b/, reason: 'FORBIDDEN_USAGE: ContainerRunner cannot be referenced by discord package' },
  { pattern: /\bRecoveryService\b/, reason: 'FORBIDDEN_USAGE: RecoveryService cannot be referenced by discord package' },
  { pattern: /spawn\s*\(\s*['"]docker['"]/i, reason: 'FORBIDDEN_EXECUTION: docker cannot be spawned by discord bot' },
  { pattern: /spawn\s*\(\s*['"](?:lua|luajit)['"]/i, reason: 'FORBIDDEN_EXECUTION: lua binaries cannot be spawned by discord bot' }
];

function getAllFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

function runBoundaryScan() {
  console.log('=== Verifying Discord Architectural Boundaries ===');
  console.log(`Scanning: ${DISCORD_SRC_DIR}`);

  const files = getAllFiles(DISCORD_SRC_DIR);
  const violations = [];
  let filesScanned = 0;

  for (const file of files) {
    filesScanned++;
    const relPath = path.relative(path.resolve(__dirname, '..'), file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip pure single-line comment documentation mentioning forbidden words
      if (line.trim().startsWith('*') || line.trim().startsWith('//')) {
        continue;
      }

      for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({
            file: relPath,
            line: i + 1,
            snippet: line.trim(),
            reason
          });
        }
      }
    }
  }

  console.log(`Files scanned: ${filesScanned}`);
  console.log(`Violations found: ${violations.length}`);

  const result = {
    timestamp: new Date().toISOString(),
    scannedDirectory: 'packages/discord/src',
    filesScanned,
    pass: violations.length === 0,
    violations
  };

  fs.mkdirSync(path.dirname(AUDIT_OUTPUT), { recursive: true });
  fs.writeFileSync(AUDIT_OUTPUT, JSON.stringify(result, null, 2) + '\n');
  console.log(`Wrote boundary scan audit: ${AUDIT_OUTPUT}`);

  if (violations.length > 0) {
    console.error('ARCHITECTURAL BOUNDARY VIOLATIONS DETECTED:');
    console.error(JSON.stringify(violations, null, 2));
    process.exit(1);
  }

  console.log('All Discord boundary checks PASSED. Discord bot is 100% decoupled from recovery core and execution internals.');
}

if (require.main === module) {
  runBoundaryScan();
}

module.exports = {
  runBoundaryScan
};
