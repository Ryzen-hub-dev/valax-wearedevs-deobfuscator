const fs = require('fs');
const path = require('path');
const { ConstantEvaluator } = require('../packages/core/src/evaluator/constant-evaluator');
const { parse } = require('../packages/core/src/parser');

function auditConstantFolding() {
  const evaluator = new ConstantEvaluator();

  const edgeCases = [
    // Modulo tests (Lua sign convention)
    { expr: '7 % 5', expected: 2 },
    { expr: '-7 % 5', expected: 3 },
    { expr: '7 % -5', expected: -3 },
    { expr: '-7 % -5', expected: -2 },
    // Division
    { expr: '10 / 2', expected: 5 },
    { expr: '10 / 0', expectedUnfolded: true },
    { expr: '0 / 0', expectedUnfolded: true },
    // Power
    { expr: '2 ^ 3', expected: 8 },
    { expr: '(-2) ^ 2', expected: 4 },
    { expr: '(-2) ^ 0.5', expectedUnfolded: true }, // NaN -> must not fold
    // Nested arithmetic from WeAreDevs fixture
    { expr: '514856 + -514855', expected: 1 },
    { expr: '-559362 - (-559426)', expected: 64 },
    { expr: '12816747 - (-731938)', expected: 13548685 },
    { expr: '256722 - 202981', expected: 53741 },
    { expr: '106837 + -106836', expected: 1 },
    { expr: '-292788 - (-293927)', expected: 1139 },
    // Truthiness & logical
    { expr: 'not 0', expected: false },
    { expr: 'not ""', expected: false },
    { expr: 'not false', expected: true },
    { expr: 'not nil', expected: true },
    { expr: '0 and 42', expected: 42 },
    { expr: 'false and 42', expected: false },
    { expr: 'nil or 100', expected: 100 },
    { expr: '0 or 100', expected: 0 },
    // Relational
    { expr: '10 < 20', expected: true },
    { expr: '20 < 10', expected: false },
    { expr: '10 == 10', expected: true },
    { expr: '10 ~= 20', expected: true },
    { expr: '10 == "10"', expected: false },
    { expr: '10 ~= "10"', expected: true },
    // String concatenation
    { expr: '"hello " .. "world"', expected: 'hello world' }
  ];

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const tc of edgeCases) {
    const ast = parse(`local x = ${tc.expr}`);
    const foldedAst = evaluator.fold(ast);
    const initNode = foldedAst.body[0].init[0];

    let success = false;
    let actualValue = null;

    if (tc.expectedUnfolded) {
      // Expression must NOT have folded to a numeric literal
      if (initNode.type !== 'NumericLiteral') {
        success = true;
        actualValue = `<Unfolded ${initNode.type}>`;
      } else {
        actualValue = initNode.value;
      }
    } else {
      if (initNode.type === 'NumericLiteral' || initNode.type === 'BooleanLiteral' || initNode.type === 'StringLiteral') {
        const val = initNode.value instanceof Object && initNode.value.toString ? initNode.value.toString('latin1') : initNode.value;
        actualValue = val;
        success = val === tc.expected;
      } else {
        actualValue = `<Unfolded ${initNode.type}>`;
      }
    }

    if (success) passed++;
    else failed++;

    results.push({
      expr: tc.expr,
      expected: tc.expected !== undefined ? tc.expected : 'UNFOLDED',
      actual: actualValue,
      status: success ? 'PASS' : 'FAIL'
    });
  }

  // 100 randomized arithmetic stress tests
  let randomPassed = 0;
  for (let i = 0; i < 100; i++) {
    const a = Math.floor(Math.random() * 2000000) - 1000000;
    const b = Math.floor(Math.random() * 2000000) - 1000000;
    const op = ['+', '-', '*'][Math.floor(Math.random() * 3)];
    let ref;
    if (op === '+') ref = a + b;
    else if (op === '-') ref = a - b;
    else ref = a * b;

    const ast = parse(`local x = ${a} ${op} (${b})`);
    const folded = evaluator.fold(ast);
    const val = folded.body[0].init[0].value;
    if (val === ref) randomPassed++;
  }

  const report = {
    totalDeterministicTests: edgeCases.length,
    passedDeterministic: passed,
    failedDeterministic: failed,
    randomizedStressTests: 100,
    randomizedPassed: randomPassed,
    verdict: failed === 0 && randomPassed === 100 ? 'PASS' : 'FAIL',
    testResults: results
  };

  fs.writeFileSync(path.resolve(__dirname, 'constant-folding-audit.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('Wrote audit/constant-folding-audit.json');
  return report;
}

if (require.main === module) {
  const r = auditConstantFolding();
  console.log(JSON.stringify(r, null, 2));
}

module.exports = { auditConstantFolding };
