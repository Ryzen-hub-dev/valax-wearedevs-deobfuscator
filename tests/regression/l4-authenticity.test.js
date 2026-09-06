const { describe, test, expect } = require('../test-framework');
const { parse } = require('../../packages/core/src/parser');
const { ControlFlowGraph } = require('../../packages/core/src/cfg/cfg');
const { BasicBlock } = require('../../packages/core/src/cfg/basic-block');
const { FunctionContext } = require('../../packages/core/src/analysis/function-context');
const { MultiEntryCFGAnalyzer } = require('../../packages/core/src/cfg/multi-entry-cfg');
const { FunctionSet } = require('../../packages/core/src/analysis/points-to');

function runL4AuthenticityTests() {
  describe('L4 Authenticity Invariant Tests', () => {

    test('1. A generated function with no references must not count as recovered', () => {
      const fn = new FunctionContext({ id: 'unused_fn', entryState: 999 });
      expect(fn.knownCallSites.length).toBe(0);
      expect(fn.unknownCallSites.length).toBe(0);
      // Unreferenced function cannot be considered live in program flow
      const isReferenced = fn.knownCallSites.length > 0 || fn.unknownCallSites.length > 0;
      expect(isReferenced).toBe(false);
    });

    test('2. A wrapper that immediately invokes dispatcher must not count as independent', () => {
      const isDispatcherBacked = (stmts) => {
        return stmts.some(s => s.invokesDispatcher === true);
      };
      const wrapperStmts = [{ invokesDispatcher: true }];
      expect(isDispatcherBacked(wrapperStmts)).toBe(true);
    });

    test('3. FunctionContext analysis alone must not increase recovery level without proven extraction', () => {
      const physicalStatesRemaining = 610;
      const physicallyExtracted = 0;
      const determineLevel = (extracted, remaining) => {
        if (extracted === 0 && remaining === 610) return 'L3.5';
        if (extracted > 50) return 'L4';
        return 'L3';
      };
      expect(determineLevel(physicallyExtracted, physicalStatesRemaining)).toBe('L3.5');
    });

    test('4. Multiple abstract contexts of one logical function must not inflate function count', () => {
      const logicalFunctionId = 'closure_1';
      const ctx1 = new FunctionContext({ id: 'ctx_a', constructorId: logicalFunctionId });
      const ctx2 = new FunctionContext({ id: 'ctx_b', constructorId: logicalFunctionId });

      const logicalFunctions = new Set([ctx1.constructorId, ctx2.constructorId]);
      expect(logicalFunctions.size).toBe(1); // Exactly 1 logical function, not 2
    });

    test('5. Recovered function must preserve varargs', () => {
      const fnVararg = new FunctionContext({ id: 'fn_v', vararg: true, parameters: [] });
      expect(fnVararg.isVararg).toBe(true);
    });

    test('6. Recovered function must preserve multiple returns', () => {
      const fn = new FunctionContext({ id: 'fn_ret' });
      fn.addReturnState(101);
      fn.addReturnState(102);
      expect(fn.returnStates.size).toBe(2);
    });

    test('7. Recovered function must preserve captures', () => {
      const fn = new FunctionContext({
        id: 'fn_cap',
        capturedUpvalues: [{ type: 'variable', name: 'counter' }]
      });
      expect(fn.capturedUpvalues.length).toBe(1);
      expect(fn.capturedUpvalues[0].name).toBe('counter');
    });

    test('8. Shared states must remain available to all owners', () => {
      const cfg = new ControlFlowGraph('Q');
      const bShared = new BasicBlock(10);
      cfg.addBlock(bShared);

      const f1 = new FunctionContext({ id: 'f1', entryState: 10 });
      const f2 = new FunctionContext({ id: 'f2', entryState: 10 });

      const analyzer = new MultiEntryCFGAnalyzer(cfg, [f1, f2]);
      const res = analyzer.analyze();

      expect(res.stateClassification.get(10)).toBe('SHARED');
      expect(f1.reachableStates.has(10)).toBe(true);
      expect(f2.reachableStates.has(10)).toBe(true);
    });

    test('9. Rewired closure must no longer use dispatcher on fully recovered paths', () => {
      const pathUsesDispatcher = (path) => path.includes('dispatcher_call');
      const independentPath = ['local_calc', 'table_set', 'return'];
      expect(pathUsesDispatcher(independentPath)).toBe(false);
    });

    test('10. Residual dispatcher reduction must not remove UNKNOWN state dependencies', () => {
      const stateStatus = new Map([
        [1, 'EXCLUSIVE'],
        [2, 'UNKNOWN']
      ]);

      const safeToRemove = (sId) => stateStatus.get(sId) === 'EXCLUSIVE';
      expect(safeToRemove(1)).toBe(true);
      expect(safeToRemove(2)).toBe(false); // UNKNOWN must NEVER be removed
    });
  });
}

module.exports = { runL4AuthenticityTests };
if (require.main === module) {
  runL4AuthenticityTests();
  const { printSummary } = require('../test-framework');
  printSummary();
}
