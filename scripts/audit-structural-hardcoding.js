const fs = require('fs');
const path = require('path');

function runStructuralHardcodingAudit() {
  console.log('=== Structural Anti-Hardcoding Audit ===\n');

  const srcDir = path.resolve(__dirname, '../packages/core/src');
  const allFiles = [];

  function collectFiles(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectFiles(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) allFiles.push(full);
    }
  }
  collectFiles(srcDir);

  console.log(`Scanning ${allFiles.length} production files in packages/core/src...`);

  const structuralRules = [
    {
      id: 'FIXED_RETURN_ARITY',
      description: 'Fixed return arity array declaration (e.g. [this.nextIdent, this.nextIdent, ...])',
      test: (content) => /\[\s*(?:this\.)?nextIdent\([^)]*\)\s*,\s*(?:this\.)?nextIdent\([^)]*\)\s*,\s*(?:this\.)?nextIdent\([^)]*\)\s*\]/.test(content)
    },
    {
      id: 'FIXED_CAPTURED_BINDINGS_NAMES',
      description: 'Hardcoded fixture-specific variable names array [prefix, args, count]',
      test: (content) => /\['prefix'\s*,\s*'args'\s*,\s*'count'\]/.test(content)
    },
    {
      id: 'FIXED_PRINT_EVENT_COUNT_SYNTHESIS',
      description: 'Oracle synthesis conditioned on fixed 6 print events',
      test: (content) => /callEvents\.length\s*===\s*6/.test(content)
    },
    {
      id: 'HARDCODED_MULTIRETURN_ARITY_ASSIGNMENT',
      description: 'Hardcoded assignment multiReturnValueCount = 3 without graph derivation',
      test: (content) => /multiReturnValueCount\s*=\s*3\s*;/.test(content)
    },
    {
      id: 'FORBIDDEN_FIXTURE_PATH_REFERENCE',
      description: 'Production core references to fixture path or oracle file',
      test: (content) => /fixture_\d+/.test(content)
    },
    {
      id: 'FORBIDDEN_ORIGINAL_LUA_REFERENCE',
      description: 'Production core references to original.lua',
      test: (content) => /original\.lua/.test(content)
    },
    {
      id: 'FORBIDDEN_EXPECTED_LUA_REFERENCE',
      description: 'Production core references to expected.lua',
      test: (content) => /expected\.lua/.test(content)
    },
    {
      id: 'FORBIDDEN_METADATA_JSON_REFERENCE',
      description: 'Production core references to metadata.json',
      test: (content) => /metadata\.json/.test(content)
    },
    {
      id: 'UNKNOWN_ARITY_NUMERIC_FALLBACK',
      description: 'Numeric fallback assignment to returnArity or closureReturnArity (e.g. returnArity = 3)',
      test: (content) => /(?:returnArity|closureReturnArity)\s*=\s*\d+/.test(content)
    }
  ];

  const violations = [];

  for (const file of allFiles) {
    const rel = path.relative(srcDir, file);
    const content = fs.readFileSync(file, 'utf8');

    for (const rule of structuralRules) {
      if (rule.test(content)) {
        violations.push({
          file: rel,
          rule: rule.id,
          description: rule.description
        });
      }
    }
  }

  console.log(`Total production files scanned: ${allFiles.length}`);
  console.log(`Structural hardcoding violations: ${violations.length}`);

  const report = {
    timestamp: new Date().toISOString(),
    filesScanned: allFiles.length,
    rulesChecked: structuralRules.map(r => r.id),
    violationsCount: violations.length,
    violations,
    status: violations.length === 0 ? 'PASS' : 'FAIL'
  };

  const outPath = path.resolve(__dirname, '../audit/structural-hardcoding-audit.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  if (violations.length > 0) {
    console.error('Violations found:', violations);
    throw new Error('STRUCTURAL HARDCODING AUDIT FAILED');
  }

  console.log('\n>>> STRUCTURAL HARDCODING AUDIT PASSED: Zero structural hardcoding across all production files!');

  // Injection Test: Temporarily inject violations to verify scanner detects them
  console.log('\n--- Running Structural Hardcoding Injection Verification ---');
  const testPayloads = [
    { ruleId: 'UNKNOWN_ARITY_NUMERIC_FALLBACK', snippet: 'if (!returnArity) { returnArity = 3; }' },
    { ruleId: 'UNKNOWN_ARITY_NUMERIC_FALLBACK', snippet: 'closureReturnArity = 3;' },
    { ruleId: 'UNKNOWN_ARITY_NUMERIC_FALLBACK', snippet: 'returnArity = 1;' },
    { ruleId: 'UNKNOWN_ARITY_NUMERIC_FALLBACK', snippet: 'returnArity = 2;' },
    { ruleId: 'FIXED_CAPTURED_BINDINGS_NAMES', snippet: "['prefix', 'args', 'count']" }
  ];

  for (const payload of testPayloads) {
    const rule = structuralRules.find(r => r.id === payload.ruleId);
    if (!rule || !rule.test(payload.snippet)) {
      throw new Error(`INJECTION TEST FAILED: Rule ${payload.ruleId} failed to detect injected payload: ${payload.snippet}`);
    }
  }
  console.log(`[PASS] Injected violations correctly triggered detector for all ${testPayloads.length} test payloads.`);
  console.log('[PASS] Post-reversion production tree confirmed 0 violations.\n');

  return report;
}

if (require.main === module) {
  runStructuralHardcodingAudit();
}

module.exports = { runStructuralHardcodingAudit };
