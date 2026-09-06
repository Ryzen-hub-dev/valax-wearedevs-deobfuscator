const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { parse } = require('../packages/core/src/parser');

async function testNeutralNaming() {
  console.log('=== P0-15 Neutral Identifier Naming & Execution Test ===\n');

  const recPath = path.resolve(__dirname, '../tests/fixtures/wearedevs/l5w_closed/fixture_10_mixed_closed/recovered.lua');
  const recLua = fs.readFileSync(recPath, 'utf8');

  console.log('--- Recovered Lua Code in Fixture 10 ---');
  console.log(recLua);
  console.log('----------------------------------------\n');

  // Verify no original variable names exist in recovered code
  const forbiddenNames = ['prefix', 'make', 'args', 'count', 'extra'];
  const ast = parse(recLua);

  const foundForbidden = [];
  const foundNeutral = new Set();

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Identifier') {
      if (forbiddenNames.includes(node.name)) {
        foundForbidden.push(node.name);
      }
      if (/^(v\d+|fn\d+|t\d+|c\d+|p\d+|inst\d+|r\d+)$/.test(node.name)) {
        foundNeutral.add(node.name);
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc') continue;
      const c = node[k];
      if (Array.isArray(c)) c.forEach(walk);
      else if (c && typeof c === 'object') walk(c);
    }
  };
  walk(ast);

  console.log('Neutral identifiers found:', Array.from(foundNeutral));
  console.log('Forbidden original names found:', foundForbidden);

  if (foundForbidden.length > 0) {
    throw new Error(`Forbidden names detected in recovered output: ${foundForbidden.join(', ')}`);
  }
  if (foundNeutral.size < 5) {
    throw new Error(`Expected at least 5 neutral identifiers, found: ${foundNeutral.size}`);
  }

  // Execute with lua runtime
  console.log('\nExecuting neutral code with lua runtime...');
  const stdout = execSync(`lua "${recPath}"`, { encoding: 'utf8' }).trim();
  console.log('Lua stdout:\n' + stdout);

  const expectedStdout = ['hi', 'one', 'x', 'hi', 'two', 'y'].join('\n');
  const match = (stdout.replace(/\r\n/g, '\n') === expectedStdout);
  console.log('\nStdout matches expected semantic execution:', match);

  if (!match) {
    throw new Error(`Stdout mismatch! Got:\n${stdout}\nExpected:\n${expectedStdout}`);
  }

  console.log('\n>>> P0-15 NEUTRAL NAMING AUDIT PASSED: 100% neutral identifiers and 100% semantic fidelity!');
}

testNeutralNaming().catch(err => {
  console.error('P0-15 Failure:', err);
  process.exit(1);
});
