const { describe, test, expect } = require('../test-framework');
const { parse } = require('../../packages/core/src/parser');
const { RecoveryPipeline } = require('../../packages/core/src/transforms/pipeline');
const { classifyError } = require('../../packages/core/src/diagnostics/failure-taxonomy');
const { traverse } = require('../../packages/core/src/ast/visitor');
const { identifier, unaryExpression } = require('../../packages/core/src/ast/nodes');
const { ConstantEvaluator } = require('../../packages/core/src/evaluator/constant-evaluator');
const { capStage, profileSourceJs } = require('../../packages/core/src/native/preflight');
const { recoverAdaptively, recoverWithStackFallback } = require('../../api/recovery')._test;

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

    test('6. AST traversal and constant folding are stack-safe at extreme structural depth', () => {
      let deepAst = identifier('runtimeValue');
      for (let i = 0; i < 20000; i++) {
        deepAst = unaryExpression('-', deepAst);
      }

      let visited = 0;
      traverse(deepAst, { enter: () => { visited++; } });
      expect(visited).toBe(20001);

      const folded = new ConstantEvaluator().fold(deepAst);
      expect(folded.type).toBeTruthy();
    });

    test('7. API safely retries a lower recovery stage after a call-stack overflow', () => {
      const attemptedStages = [];
      const result = recoverWithStackFallback('print(1)', { stage: 'L5' }, (source, options) => {
        attemptedStages.push(options.stage);
        if (options.stage === 'L5' || options.stage === 'L4') {
          throw new RangeError('Maximum call stack size exceeded');
        }
        return { code: source, report: { warnings: [] } };
      });

      expect(attemptedStages.join(',')).toBe('L5,L4,L3');
      expect(result.report.executedStage).toBe('L3');
      expect(result.report.warnings.length).toBe(1);
    });

    test('8. Preflight profiles source complexity and caps unsafe hosted stages', () => {
      const small = profileSourceJs('local value = 1\nprint(value)');
      expect(small.recommendedStage).toBe('L5');
      expect(small.tokens).toBeGreaterThan(0);

      const large = profileSourceJs('identifier '.repeat(40000));
      expect(large.recommendedStage).toBe('L4');
      expect(capStage('L5', large.recommendedStage)).toBe('L4');
      expect(capStage('L2', large.recommendedStage)).toBe('L2');
    });

    test('9. Adaptive API execution records requested and admitted stages', () => {
      let executedStage = null;
      const result = recoverAdaptively('print(1)', { stage: 'L5', filename: 'test.lua' }, {
        profiler: () => ({
          engine: 'test-native-engine',
          bytes: 8,
          tokens: 4,
          maxDepth: 1,
          recommendedStage: 'L3'
        }),
        recoveryFn: (source, options) => {
          executedStage = options.stage;
          return { code: source, report: { warnings: [] } };
        }
      });

      expect(executedStage).toBe('L3');
      expect(result.report.execution.requestedStage).toBe('L5');
      expect(result.report.execution.admittedStage).toBe('L3');
    });
  });
}

module.exports = { runFuzzTests };

if (require.main === module) {
  runFuzzTests();
  const { printSummary } = require('../test-framework');
  printSummary();
}
