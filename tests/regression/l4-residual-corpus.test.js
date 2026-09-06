const { describe, test, expect } = require('../test-framework');
const { ControlFlowGraph } = require('../../packages/core/src/cfg/cfg');
const { BasicBlock } = require('../../packages/core/src/cfg/basic-block');
const { FunctionContext } = require('../../packages/core/src/analysis/function-context');
const { MultiEntryCFGAnalyzer } = require('../../packages/core/src/cfg/multi-entry-cfg');
const { BoundedSymbolicEvaluator } = require('../../packages/core/src/analysis/symbolic-state');
const { ResidualDispatcherCompressor } = require('../../packages/core/src/transforms/residual-dispatcher');
const { parse } = require('../../packages/core/src/parser');

function runL4ResidualCorpusTests() {
  describe('Phase 23: L4 Residual Dispatcher & Extraction Test Suite', () => {

    test('1. Shared state split by captured boolean discriminator', () => {
      const cfg = new ControlFlowGraph('Q');
      const bShared = new BasicBlock(100);
      cfg.addBlock(bShared);

      const f1 = new FunctionContext({ id: 'fn_a', entryState: 100 });
      const f2 = new FunctionContext({ id: 'fn_b', entryState: 100 });

      const analyzer = new MultiEntryCFGAnalyzer(cfg, [f1, f2]);
      const res = analyzer.analyze();

      expect(res.stateClassification.get(100)).toBe('SHARED');
      expect(f1.reachableStates.has(100)).toBe(true);
      expect(f2.reachableStates.has(100)).toBe(true);
    });

    test('2. Finite-set table transition evaluation', () => {
      const evaluator = new BoundedSymbolicEvaluator();
      const expr = {
        type: 'LogicalExpression',
        operator: 'or',
        left: {
          type: 'LogicalExpression',
          operator: 'and',
          left: { type: 'Identifier', name: 'flag' },
          right: { type: 'NumericLiteral', value: 100 }
        },
        right: { type: 'NumericLiteral', value: 200 }
      };

      const result = evaluator.evaluate(expr, new Map());
      expect(result.kind).toBe('FiniteNumberSet');
      expect(result.values.has(100)).toBe(true);
      expect(result.values.has(200)).toBe(true);
    });

    test('3. Terminal exit recognition for Q = A[W(...)]', () => {
      const evaluator = new BoundedSymbolicEvaluator();
      const exitExpr = {
        type: 'IndexExpression',
        base: { type: 'Identifier', name: 'A' },
        index: { type: 'CallExpression', base: { type: 'Identifier', name: 'W' }, arguments: [] }
      };

      const res = evaluator.evaluate(exitExpr);
      expect(res.kind).toBe('KnownNil');
      expect(res.value).toBe(null);
    });

    test('4. Physical state removal with dispatcher compression', () => {
      const compressor = new ResidualDispatcherCompressor();
      const cfg = new ControlFlowGraph('Q');
      const b1 = new BasicBlock(50);
      cfg.addBlock(b1);

      const exclusiveProof = [
        { state: 50, status: 'EXCLUSIVE_PROVEN', safeToExtract: true }
      ];

      const extractable = compressor.findExtractableStates(cfg, exclusiveProof, new Set([50]));
      expect(extractable.has(50)).toBe(true);
      expect(compressor.stats.safeExtractionCandidates).toBe(1);
    });

    test('5. Negative test: UNKNOWN incoming edge prevents physical extraction', () => {
      const compressor = new ResidualDispatcherCompressor();
      const cfg = new ControlFlowGraph('Q');
      const bTarget = new BasicBlock(10);
      const bUnknown = new BasicBlock(20);
      cfg.addBlock(bTarget);
      cfg.addBlock(bUnknown);
      cfg.addEdge(bUnknown, bTarget);

      const exclusiveProof = [
        { state: 10, status: 'EXCLUSIVE_BUT_UNKNOWN_INCOMING', safeToExtract: false }
      ];

      const extractable = compressor.findExtractableStates(cfg, exclusiveProof, new Set());
      expect(extractable.has(10)).toBe(false); // Must NEVER extract if unknown incoming edge
    });
  });
}

module.exports = { runL4ResidualCorpusTests };
if (require.main === module) {
  runL4ResidualCorpusTests();
  const { printSummary } = require('../test-framework');
  printSummary();
}
