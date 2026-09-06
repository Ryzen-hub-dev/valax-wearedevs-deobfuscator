const { describe, test, expect } = require('../test-framework');
const { parse } = require('../../packages/core/src/parser');
const { ControlFlowGraph } = require('../../packages/core/src/cfg/cfg');
const { BasicBlock } = require('../../packages/core/src/cfg/basic-block');
const { FunctionContext } = require('../../packages/core/src/analysis/function-context');
const { MultiEntryCFGAnalyzer } = require('../../packages/core/src/cfg/multi-entry-cfg');
const { PointsToAnalyzer, FunctionSet } = require('../../packages/core/src/analysis/points-to');
const { ClosureConstructorAnalyzer } = require('../../packages/core/src/analysis/closure-analyzer');

function runL4ClosureTests() {
  describe('Phase 22: L4 Closure & Multi-Entry Analysis Test Suite', () => {

    test('analyzes two closures sharing one state machine', () => {
      const cfg = new ControlFlowGraph('Q');
      const b1 = new BasicBlock(1);
      const b2 = new BasicBlock(2);
      const bShared = new BasicBlock(3);
      cfg.addBlock(b1);
      cfg.addBlock(b2);
      cfg.addBlock(bShared);
      cfg.addEdge(b1, bShared);
      cfg.addEdge(b2, bShared);

      const f1 = new FunctionContext({ id: 'fn_1', entryState: 1 });
      const f2 = new FunctionContext({ id: 'fn_2', entryState: 2 });

      const analyzer = new MultiEntryCFGAnalyzer(cfg, [f1, f2]);
      const res = analyzer.analyze();

      expect(f1.reachableStates.has(1)).toBe(true);
      expect(f1.reachableStates.has(3)).toBe(true);
      expect(f2.reachableStates.has(2)).toBe(true);
      expect(f2.reachableStates.has(3)).toBe(true);
      expect(res.stateClassification.get(3)).toBe('SHARED');
      expect(res.stateClassification.get(1)).toBe('EXCLUSIVE');
      expect(res.stateClassification.get(2)).toBe('EXCLUSIVE');
    });

    test('analyzes closure factory and nested closures', () => {
      const source = `
        local S, R, x = ...
        local f = x(100, {})
        local g = S(200, { f })
        local h = R(300, { g, f })
      `;
      const ast = parse(source);
      const analyzer = new ClosureConstructorAnalyzer();
      const constructors = analyzer.analyze(ast);

      expect(constructors.length).toBe(3);
      expect(constructors[0].entryState).toBe(100);
      expect(constructors[1].entryState).toBe(200);
      expect(constructors[2].entryState).toBe(300);
    });

    test('analyzes callback stored in table and ambiguous pointers', () => {
      const fn1 = new FunctionContext({ id: 'fn_cb1', entryState: 100 });
      const fn2 = new FunctionContext({ id: 'fn_cb2', entryState: 200 });
      const fnSet = new FunctionSet([fn1, fn2]);

      expect(fnSet.functions.size).toBe(2);
      // Ensure conservative set does not collapse
      const arr = Array.from(fnSet.functions).map(f => f.id);
      expect(arr.includes('fn_cb1')).toBe(true);
      expect(arr.includes('fn_cb2')).toBe(true);
    });

    test('detects recursive closures with SCCs', () => {
      const cfg = new ControlFlowGraph('Q');
      const b1 = new BasicBlock(1);
      const b2 = new BasicBlock(2);
      cfg.addBlock(b1);
      cfg.addBlock(b2);
      cfg.addEdge(b1, b2);
      cfg.addEdge(b2, b1); // back-edge (loop)

      const fRec = new FunctionContext({ id: 'fn_rec', entryState: 1 });
      const analyzer = new MultiEntryCFGAnalyzer(cfg, [fRec]);
      analyzer.analyze();

      expect(fRec.sccs.length).toBe(1);
      expect(fRec.sccs[0].length).toBe(2);
    });
  });
}

module.exports = { runL4ClosureTests };
if (require.main === module) {
  runL4ClosureTests();
  const { printSummary } = require('../test-framework');
  printSummary();
}
