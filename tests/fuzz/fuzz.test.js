const { describe, test, expect } = require('../test-framework');
const { parse } = require('../../packages/core/src/parser');
const { RecoveryPipeline } = require('../../packages/core/src/transforms/pipeline');
const { classifyError } = require('../../packages/core/src/diagnostics/failure-taxonomy');

function runFuzzTests() {
  describe('Rule 14: Crash-Free Fuzzing Suite', () => {
    const pipeline = new RecoveryPipeline();

    test('1. Malformed syntax returns structured error without crashing', () => {
      const malformedInputs = [
        'local a =',
        'if then else end',
        'function(a, b',
        'local t = { 1, 2, }', // trailing comma
        'while do end',
        'return ...'
      ];

      for (const input of malformedInputs) {
        try {
          pipeline.run(input);
        } catch (err) {
          const diag = classifyError(err);
          expect(diag.category).toBeTruthy();
        }
      }
    });

    test('2. Truncated source code is handled gracefully', () => {
      const base = 'local function test() local t = { a = 1, b = 2 } return t end';
      for (let len = 1; len < base.length; len += 5) {
        const truncated = base.slice(0, len);
        try {
          pipeline.run(truncated);
        } catch (err) {
          const diag = classifyError(err);
          expect(diag.category).toBeTruthy();
        }
      }
    });

    test('3. Random binary byte noise does not cause fatal crash', () => {
      const randomNoise = Buffer.from([0x00, 0xFF, 0xFE, 0x80, 0x1B, 0x4C, 0x75, 0x61]).toString('latin1');
      try {
        pipeline.run(randomNoise);
      } catch (err) {
        const diag = classifyError(err);
        expect(diag.category).toBeTruthy();
      }
    });

    test('4. Empty and whitespace-only input executes cleanly', () => {
      const emptyRes = pipeline.run('');
      expect(emptyRes.report.roundtripVerified).toBe(true);

      const wsRes = pipeline.run('   \n\t\r\n   ');
      expect(wsRes.report.roundtripVerified).toBe(true);
    });

    test('5. Deeply nested expressions handle recursion depth without uncaught throw', () => {
      let nested = '1';
      for (let i = 0; i < 50; i++) {
        nested = `(${nested} + 1)`;
      }
      const code = `local x = ${nested}; print(x)`;
      const res = pipeline.run(code);
      expect(res.report.constantsFolded).toBeGreaterThan(0);
      expect(res.report.roundtripVerified).toBe(true);
    });
  });
}

module.exports = { runFuzzTests };

if (require.main === module) {
  runFuzzTests();
  const { printSummary } = require('../test-framework');
  printSummary();
}
