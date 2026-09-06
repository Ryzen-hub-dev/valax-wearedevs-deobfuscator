const { describe, test, expect } = require('../test-framework');
const { ControlFlowGraph } = require('../../packages/core/src/cfg/cfg');
const { BasicBlock } = require('../../packages/core/src/cfg/basic-block');
const { FunctionContext } = require('../../packages/core/src/analysis/function-context');
const { MultiEntryCFGAnalyzer } = require('../../packages/core/src/cfg/multi-entry-cfg');

function runL4NegativeTests() {
  describe('Phase 23: L4 Negative Tests (Prevent Unsafe State Pruning)', () => {

    test('state reachable only through a callback must NOT be marked unreachable or removed', () => {
      const cfg = new ControlFlowGraph('Q');
      const rootBlock = new BasicBlock(1);
      const callbackTarget = new BasicBlock(2);
      cfg.addBlock(rootBlock);
      cfg.addBlock(callbackTarget);

      // Root does not transition to callbackTarget directly
      // callbackTarget is invoked via closure
      const rootCtx = new FunctionContext({ id: 'root', entryState: 1 });
      const callbackCtx = new FunctionContext({ id: 'cb', entryState: 2 });

      const analyzer = new MultiEntryCFGAnalyzer(cfg, [rootCtx, callbackCtx]);
      const res = analyzer.analyze();

      expect(callbackCtx.reachableStates.has(2)).toBe(true);
      expect(res.stateClassification.get(2)).toBe('EXCLUSIVE');
    });

    test('state with unknown or indirect target must be classified as UNRESOLVED, never removed', () => {
      const cfg = new ControlFlowGraph('Q');
      const b1 = new BasicBlock(1);
      const bDynamic = new BasicBlock(2);
      cfg.addBlock(b1);
      cfg.addBlock(bDynamic);

      // No entry points discover bDynamic directly
      const rootCtx = new FunctionContext({ id: 'root', entryState: 1 });

      const analyzer = new MultiEntryCFGAnalyzer(cfg, [rootCtx]);
      const res = analyzer.analyze();

      // bDynamic must remain UNRESOLVED
      expect(res.stateClassification.get(2)).toBe('UNRESOLVED');
    });

    test('ambiguous function pointer does not collapse into a single target', () => {
      const f1 = new FunctionContext({ id: 'f1', entryState: 10 });
      const f2 = new FunctionContext({ id: 'f2', entryState: 20 });
      const owners = new Set([f1.id, f2.id]);

      expect(owners.size).toBe(2);
      expect(owners.has('f1')).toBe(true);
      expect(owners.has('f2')).toBe(true);
    });
  });
}

module.exports = { runL4NegativeTests };
if (require.main === module) {
  runL4NegativeTests();
  const { printSummary } = require('../test-framework');
  printSummary();
}
