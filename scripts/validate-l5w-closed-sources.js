const fs = require('fs');
const path = require('path');
const { parse } = require('../packages/core/src/parser');
const { generate } = require('../packages/core/src/generator');
const { SemanticOracle } = require('../packages/core/src/oracle/semantic-oracle');

const baseDir = path.resolve(__dirname, '../tests/fixtures/wearedevs/l5w_closed');
const auditPath = path.resolve(__dirname, '../audit/l5w-closed-source-validation.json');

const fixtureDirs = fs.readdirSync(baseDir).filter(f => f.startsWith('fixture_')).sort();

const oracle = new SemanticOracle();
const validationResults = [];

console.log('=== PRE-PROTECTION SOURCE VALIDATION FOR L5-W CLOSED GATE ===\n');

let allPassed = true;

for (const fixId of fixtureDirs) {
  const fixDir = path.join(baseDir, fixId);
  const origPath = path.join(fixDir, 'original.lua');
  const metaPath = path.join(fixDir, 'metadata.json');

  if (!fs.existsSync(origPath)) {
    console.error(`[FAIL] ${fixId}: original.lua missing`);
    allPassed = false;
    continue;
  }

  const originalSource = fs.readFileSync(origPath, 'utf8');

  // 1. Parse original
  let parsedAst = null;
  let parseOk = false;
  let parseError = null;
  try {
    parsedAst = parse(originalSource);
    parseOk = !!parsedAst && parsedAst.type === 'Chunk';
  } catch (err) {
    parseError = err.message;
  }

  // 2. AST round-trip
  let roundtripOk = false;
  let roundtripCode = null;
  let roundtripError = null;
  if (parseOk) {
    try {
      roundtripCode = generate(parsedAst);
      const reParsed = parse(roundtripCode);
      roundtripOk = !!reParsed && reParsed.type === 'Chunk';
    } catch (err) {
      roundtripError = err.message;
    }
  }

  // 3. Semantic Oracle execution
  const traceRes = oracle.trace(originalSource);
  const semanticOk = traceRes.success && Array.isArray(traceRes.events) && traceRes.events.length > 0;

  // Extract stdout lines from CALL events to print
  const printEvents = (traceRes.events || []).filter(e => e.type === 'CALL' && e.target === 'print');
  const printOutputs = printEvents.map(e => (e.args || []).map(a => String(a.value)).join('\t'));

  const fixturePassed = parseOk && roundtripOk && semanticOk;
  if (!fixturePassed) allPassed = false;

  const result = {
    fixtureId: fixId,
    parseOk,
    parseError,
    roundtripOk,
    roundtripError,
    semanticOk,
    instructionsExecuted: traceRes.instructionsExecuted || null,
    printOutputs,
    eventsCount: traceRes.events ? traceRes.events.length : 0,
    status: fixturePassed ? 'PASS' : 'FAIL'
  };

  validationResults.push(result);

  console.log(`[${result.status}] ${fixId}:`);
  console.log(`       Parse: ${parseOk ? 'OK' : 'FAIL'}, Roundtrip: ${roundtripOk ? 'OK' : 'FAIL'}, Semantic: ${semanticOk ? 'OK' : 'FAIL'}`);
  console.log(`       Outputs: ${JSON.stringify(printOutputs)}`);
}

const audit = {
  timestamp: new Date().toISOString(),
  gate: 'L5-W_CLOSED_PROGRAM_PRE_PROTECTION_VALIDATION',
  totalFixtures: validationResults.length,
  passedCount: validationResults.filter(r => r.status === 'PASS').length,
  failedCount: validationResults.filter(r => r.status === 'FAIL').length,
  allPassed,
  results: validationResults
};

fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf8');

console.log(`\n========================================`);
console.log(`Pre-protection validation: ${audit.passedCount} / ${audit.totalFixtures} PASS`);
console.log(`Audit saved to ${auditPath}`);
console.log(`========================================\n`);

if (!allPassed) {
  process.exit(1);
}
