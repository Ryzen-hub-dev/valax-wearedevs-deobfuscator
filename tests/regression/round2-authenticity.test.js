const assert = require('assert');
const { describe, test, expect } = require('../test-framework');
const {
  SemanticOpKind,
  ClosureKind,
  BranchKind,
  MultiReturnKind,
  SemanticOpProvenance,
  Binding,
  UpvalueGet,
  UpvalueSet,
  BinaryAdd,
  Branch,
  MultiReturn,
  ClosureNew,
  VarargPack
} = require('../../packages/core/src/ir/semantic-op');
const {
  TableNode,
  EnvironmentNode,
  ClosureNode,
  CallEdge,
  EnvironmentGraph,
  AbstractInterpreter
} = require('../../packages/core/src/analysis/environment-graph');
const { VMLifter } = require('../../packages/core/src/analysis/vm-lifter');
const { ResidualDispatcherCompressor } = require('../../packages/core/src/transforms/residual-dispatcher');

function runRound2AuthenticityTests() {
  describe('Round 2 Authenticity & Integrity Test Suite', () => {
    test('1. SemanticOpProvenance strictly rejects prohibited sources', () => {
      assert.throws(() => {
        new SemanticOpProvenance({
          opId: 'OP1',
          type: SemanticOpKind.UPVALUE_GET,
          originState: 100,
          proofSource: 'SEMANTIC_TRACE'
        });
      }, /Prohibited proofSource/);

      assert.throws(() => {
        new SemanticOpProvenance({
          opId: 'OP2',
          type: SemanticOpKind.BRANCH,
          originState: 100,
          proofSource: 'ORIGINAL_SOURCE'
        });
      }, /Prohibited proofSource/);

      const validProv = new SemanticOpProvenance({
        opId: 'OP3',
        type: SemanticOpKind.VARARG_PACK,
        originState: 11312743,
        originStatements: ['A = { K(1, V(J)) }'],
        bindingId: 'B_VARARG_TABLE',
        environmentId: 'E1',
        confidence: 'PROVEN_STATIC',
        proofSource: 'VM_IR',
        justification: 'Vararg vector J unpacked via K(1, V(J))'
      });
      expect(validProv.proofSource).toBe('VM_IR');
    });

    test('2. ResidualDispatcherCompressor raises STATE_ACCOUNTING_FAILURE on discrepancy', () => {
      const compressor = new ResidualDispatcherCompressor();
      expect(compressor.validateConservation({
        beforeStates: 76,
        remainingStates: 58,
        liftedAndReplacedStates: 18,
        provenUnreachableStates: 0,
        provenRedundantStates: 0
      })).toBe(true);

      assert.throws(() => {
        compressor.validateConservation({
          beforeStates: 76,
          remainingStates: 58,
          liftedAndReplacedStates: 10,
          provenUnreachableStates: 0,
          provenRedundantStates: 0
        });
      }, /STATE_ACCOUNTING_FAILURE/);
    });

    test('3. VMLifter detects and rejects UPVALUE_CELL_ALIAS_FAILURE', () => {
      const lifter = new VMLifter();
      const fakeCfg = {
        blocks: new Map([
          [100, {
            statements: [
              { type: 'AssignmentStatement', variables: [{ type: 'Identifier', name: 'P' }], init: [{ type: 'StringLiteral', raw: 'b[n[1]]' }] },
              { type: 'AssignmentStatement', variables: [{ type: 'Identifier', name: 'G' }], init: [{ type: 'StringLiteral', raw: 'P + 1' }] },
              { type: 'AssignmentStatement', variables: [{ type: 'StringLiteral', raw: 'b[n[2]]' }], init: [{ type: 'Identifier', name: 'G' }] }
            ]
          }]
        ])
      };
      assert.throws(() => {
        lifter.lift(fakeCfg);
      }, /UPVALUE_CELL_ALIAS_FAILURE/);
    });

    test('4. ClosureKind taxonomy formally distinguishes source vs helper closures', () => {
      expect(ClosureKind.SOURCE_CLOSURE).toBe('SOURCE_CLOSURE');
      expect(ClosureKind.VM_HELPER_CLOSURE).toBe('VM_HELPER_CLOSURE');
      expect(ClosureKind.RUNTIME_WRAPPER).toBe('RUNTIME_WRAPPER');
    });

    test('5. EnvironmentGraph & AbstractInterpreter track persistent upvalue state (0 -> 1 -> 2)', () => {
      const graph = new EnvironmentGraph();
      const env0 = new EnvironmentNode({ envId: 'E0', scopeType: 'ROOT' });
      const bPrefix = new Binding({
        bindingId: 'B_PREFIX',
        displayName: null,
        storage: 'UPVALUE_CELL',
        initialValue: 'hi'
      });
      env0.addBinding(bPrefix);
      graph.addEnvironment(env0);

      const env1 = new EnvironmentNode({ envId: 'E1', parentEnvId: 'E0', scopeType: 'FACTORY' });
      const t1 = new TableNode({
        tableId: 'T1',
        allocationSite: 11312743,
        source: 'VARARG_PACK',
        entries: new Map([[1, 'one'], [2, 'two']]),
        provenOrdering: ['one', 'two']
      });
      const bArgs = new Binding({
        bindingId: 'B_ARGS',
        displayName: null,
        storage: 'TABLE_OBJECT',
        initialValue: t1
      });
      const bCount = new Binding({
        bindingId: 'B_COUNT',
        displayName: null,
        storage: 'MUTABLE_CELL',
        initialValue: 0
      });
      env1.addBinding(bPrefix);
      env1.addBinding(bArgs);
      env1.addBinding(bCount);
      env1.allocatedTables.set('T1', t1);
      graph.addEnvironment(env1);

      const closure = new ClosureNode({
        closureId: 'C1',
        entryState: 11288827,
        closureKind: ClosureKind.SOURCE_CLOSURE,
        environmentId: 'E1',
        capturedBindings: ['B_COUNT', 'B_PREFIX', 'B_ARGS']
      });
      graph.addClosure(closure);

      const interp = new AbstractInterpreter(graph);
      interp.initializeCell('E1', 'B_COUNT', 0);

      const callEdge1 = new CallEdge({
        invocationId: 'I2',
        caller: 'ROOT',
        callee: 'C1',
        args: ['x'],
        environmentId: 'E1'
      });

      const liftedOps = [
        new UpvalueGet('B_COUNT', null, 11258761),
        new BinaryAdd('B_COUNT', 'B_COUNT', 1, 11258761),
        new UpvalueSet('B_COUNT', 'B_COUNT + 1', null, 11258761),
        new Branch('cond == 1', 6990301, 13226741, 11258761, BranchKind.SOURCE_BRANCH),
        new MultiReturn(['RET_VAL_1', 'RET_VAL_2', 'RET_VAL_3'], 6981980, MultiReturnKind.SOURCE_MULTI_RETURN)
      ];

      const trace1 = interp.executeInvocation(callEdge1, closure, liftedOps);
      expect(trace1.mutations[0].before).toBe(0);
      expect(trace1.mutations[0].after).toBe(1);
      expect(trace1.branchEvaluations[0].outcome).toBe(true);
      expect(trace1.branchEvaluations[0].takenTarget).toBe(6990301);

      const callEdge2 = new CallEdge({
        invocationId: 'I3',
        caller: 'ROOT',
        callee: 'C1',
        args: ['y'],
        environmentId: 'E1'
      });

      const trace2 = interp.executeInvocation(callEdge2, closure, liftedOps);
      expect(trace2.mutations[0].before).toBe(1);
      expect(trace2.mutations[0].after).toBe(2);
      expect(trace2.branchEvaluations[0].outcome).toBe(false);
      expect(trace2.branchEvaluations[0].takenTarget).toBe(13226741);
    });
  });
}

if (require.main === module) {
  runRound2AuthenticityTests();
}

module.exports = { runRound2AuthenticityTests };

