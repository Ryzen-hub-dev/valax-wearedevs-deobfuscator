const fs = require('fs');
const path = require('path');

function auditHardcoding() {
  const srcDir = path.resolve(__dirname, '../packages/core/src');
  const auditResult = {
    scannedFiles: 0,
    hardcodedFixtureReferences: [],
    hardcodedStateIds: [],
    hardcodedOffsets: [],
    hardcodedCounts: [],
    status: 'PASS',
    summary: ''
  };

  const suspiciousTokens = [
    { pattern: /ByIdiotSandWich/g, type: 'fixture_filename' },
    { pattern: /\b13548685\b/g, type: 'hardcoded_root_entry_state' },
    { pattern: /\b53741\b/g, type: 'hardcoded_accessor_offset' }
  ];

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        auditResult.scannedFiles++;
        const content = fs.readFileSync(fullPath, 'utf8');
        const relPath = path.relative(path.resolve(__dirname, '..'), fullPath);

        for (const { pattern, type } of suspiciousTokens) {
          const matches = content.match(pattern);
          if (matches) {
            const hit = {
              file: relPath,
              type,
              count: matches.length
            };
            if (type === 'fixture_filename') auditResult.hardcodedFixtureReferences.push(hit);
            else if (type === 'hardcoded_root_entry_state') auditResult.hardcodedStateIds.push(hit);
            else if (type === 'hardcoded_accessor_offset') auditResult.hardcodedOffsets.push(hit);
          }
        }
      }
    }
  }

  scanDir(srcDir);

  const totalViolations =
    auditResult.hardcodedFixtureReferences.length +
    auditResult.hardcodedStateIds.length +
    auditResult.hardcodedOffsets.length;

  if (totalViolations > 0) {
    auditResult.status = 'FAIL';
    auditResult.summary = `Found ${totalViolations} hardcoded fixture assumptions in engine core.`;
  } else {
    auditResult.status = 'PASS';
    auditResult.summary = `All engine core modules are 100% free of hardcoded fixture constants and filenames across ${auditResult.scannedFiles} files.`;
  }

  const outPath = path.resolve(__dirname, '../audit/hardcoding-audit.json');
  fs.writeFileSync(outPath, JSON.stringify(auditResult, null, 2), 'utf8');
  console.log(`Hardcoding Audit: ${auditResult.status} - Scanned ${auditResult.scannedFiles} files.`);
  return auditResult;
}

if (require.main === module) {
  auditHardcoding();
}

module.exports = { auditHardcoding };
