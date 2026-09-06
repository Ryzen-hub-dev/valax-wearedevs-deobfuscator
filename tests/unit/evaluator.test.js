const { describe, test, expect } = require('../test-framework');
const { parse } = require('../../packages/core/src/parser');
const { foldConstants } = require('../../packages/core/src/evaluator');
const { generate } = require('../../packages/core/src/generator');

function runEvaluatorTests() {
  describe('Phase 2: Numeric Expression Normalization (Constant Evaluator)', () => {
    test('simplifies 514856 + -514855 to 1', () => {
      const ast = parse('local x = 514856 + -514855');
      const { ast: folded, stats } = foldConstants(ast);
      expect(stats.expressionsSimplified).toBeGreaterThan(0);
      const code = generate(folded);
      expect(code).toContain('local x = 1');
    });

    test('simplifies -559362 - (-559426) to 64', () => {
      const ast = parse('local x = -559362 - (-559426)');
      const { ast: folded } = foldConstants(ast);
      const code = generate(folded);
      expect(code).toContain('local x = 64');
    });

    test('folds complex nested constant arithmetic', () => {
      const ast = parse('local x = ((10 + 20) * 3 - 10) / 4'); // (30 * 3 - 10) / 4 = 80 / 4 = 20
      const { ast: folded } = foldConstants(ast);
      const code = generate(folded);
      expect(code).toContain('local x = 20');
    });

    test('folds boolean and relational expressions', () => {
      const ast = parse('local a = 10 < 20; local b = 5 == 5; local c = true and "yes"; local d = false or "no"');
      const { ast: folded } = foldConstants(ast);
      const code = generate(folded);
      expect(code).toContain('local a = true');
      expect(code).toContain('local b = true');
      expect(code).toContain('local c = "yes"');
      expect(code).toContain('local d = "no"');
    });

    test('does not evaluate expressions depending on runtime variables', () => {
      const ast = parse('local x = runtimeVar + 10');
      const { ast: folded, stats } = foldConstants(ast);
      const code = generate(folded);
      expect(code).toContain('runtimeVar + 10');
      expect(stats.unsafeExpressionsSkipped).toBe(1);
    });

    test('folds string concatenation', () => {
      const ast = parse('local s = "hello " .. "world"');
      const { ast: folded } = foldConstants(ast);
      const code = generate(folded);
      expect(code).toContain('local s = "hello world"');
    });
  });
}

module.exports = { runEvaluatorTests };
if (require.main === module) {
  runEvaluatorTests();
  const { printSummary } = require('../test-framework');
  printSummary();
}
