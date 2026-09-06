const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parse } = require('../packages/core/src/parser');
const { generate } = require('../packages/core/src/generator');

function validateGateASources() {
  const packDir = path.resolve(__dirname, '../incoming-source-pack');
  const manifestPath = path.join(packDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const validationResults = {
    totalSources: manifest.fixtures.length,
    passedCount: 0,
    failedCount: 0,
    results: []
  };

  const forbiddenTokens = ['io.', 'os.date', 'os.time', 'math.random', 'socket', 'http', 'loadfile', 'dofile'];

  for (const f of manifest.fixtures) {
    const fDir = path.join(packDir, f.fixtureId);
    const origPath = path.join(fDir, 'original.lua');
    const expPath = path.join(fDir, 'expected.json');

    const origCode = fs.readFileSync(origPath, 'utf8');
    const expected = JSON.parse(fs.readFileSync(expPath, 'utf8'));

    const item = {
      fixtureId: f.fixtureId,
      title: f.title,
      parse: 'FAIL',
      roundtrip: 'FAIL',
      deterministicExecution: 'FAIL',
      forbiddenDependencies: 'CLEAN',
      status: 'FAIL'
    };

    // 1. Check forbidden tokens
    for (const tok of forbiddenTokens) {
      if (origCode.includes(tok)) {
        item.forbiddenDependencies = `FOUND_${tok}`;
        break;
      }
    }

    // 2. Parser check
    let ast = null;
    try {
      ast = parse(origCode);
      item.parse = 'PASS';
    } catch (e) {
      item.parse = `ERROR: ${e.message}`;
    }

    // 3. Round-trip check
    if (ast) {
      try {
        const generated = generate(ast);
        const reAst = parse(generated);
        if (reAst && reAst.type === 'Chunk') {
          item.roundtrip = 'PASS';
        }
      } catch (e) {
        item.roundtrip = `ERROR: ${e.message}`;
      }
    }

    // 4. Execution check with luajit
    try {
      const stdout = execSync(`luajit "${origPath}"`, { timeout: 3000 }).toString().trim();
      const actualObj = JSON.parse(stdout);
      if (JSON.stringify(actualObj) === JSON.stringify(expected)) {
        item.deterministicExecution = 'PASS';
      } else {
        item.deterministicExecution = 'DIFF';
      }
    } catch (e) {
      item.deterministicExecution = `ERROR: ${e.message}`;
    }

    if (item.parse === 'PASS' && item.roundtrip === 'PASS' && item.deterministicExecution === 'PASS' && item.forbiddenDependencies === 'CLEAN') {
      item.status = 'PASS';
      validationResults.passedCount++;
    } else {
      validationResults.failedCount++;
    }

    validationResults.results.push(item);
    console.log(`Validation ${f.fixtureId}: ${item.status} (Parse: ${item.parse}, Roundtrip: ${item.roundtrip}, Exec: ${item.deterministicExecution})`);
  }

  const outPath = path.resolve(__dirname, '../audit/gate-a-source-validation.json');
  fs.writeFileSync(outPath, JSON.stringify(validationResults, null, 2), 'utf8');
  console.log(`Gate A Source Validation: ${validationResults.passedCount} / ${validationResults.totalSources} passed.`);
  return validationResults;
}

if (require.main === module) {
  validateGateASources();
}

module.exports = { validateGateASources };
