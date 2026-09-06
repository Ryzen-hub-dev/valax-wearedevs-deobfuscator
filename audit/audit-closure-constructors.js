const fs = require('fs');
const path = require('path');
const { parse } = require('../packages/core/src/parser');
const { ClosureConstructorAnalyzer } = require('../packages/core/src/analysis/closure-analyzer');

function auditClosureConstructors() {
  const sourcePath = path.resolve(__dirname, '../result.lua');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const ast = parse(source);

  const analyzer = new ClosureConstructorAnalyzer();
  const constructors = analyzer.analyze(ast);

  // Group by helper and entryState
  const helperBreakdown = {};
  const uniqueStates = new Set();

  for (const c of constructors) {
    helperBreakdown[c.helper] = (helperBreakdown[c.helper] || 0) + 1;
    if (c.entryState !== null) {
      uniqueStates.add(c.entryState);
    }
  }

  const report = {
    totalClosureConstructors: constructors.length,
    uniqueEntryStates: uniqueStates.size,
    helperBreakdown,
    constructors: constructors.map(c => ({
      constructorId: c.constructorId,
      helper: c.helper,
      sourceLocation: c.sourceLocation,
      entryState: c.entryState,
      entryStateConfidence: c.entryStateConfidence,
      parameters: c.parameters,
      paramCount: c.paramCount,
      vararg: c.vararg,
      capturedValues: c.capturedValues,
      storedInto: c.storedInto,
      returnedTo: c.returnedTo,
      calledFrom: c.calledFrom
    }))
  };

  const outPath = path.resolve(__dirname, 'closure-constructors.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Discovered ${constructors.length} closure constructors (${uniqueStates.size} unique entry states).`);
  console.log('Wrote audit/closure-constructors.json');
  return report;
}

if (require.main === module) {
  auditClosureConstructors();
}

module.exports = { auditClosureConstructors };
