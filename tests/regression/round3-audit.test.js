const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../test-framework');

const {
  SemanticASTEmitter,
  ASTNodeProvenance,
  IdentifierProvenance
} = require('../../packages/core/src/analysis/semantic-ast-emitter');

const {
  SemanticGraphCompletenessVerifier
} = require('../../packages/core/src/analysis/semantic-graph-completeness-verifier');

const {
  VMDependencyGraph
} = require('../../packages/core/src/analysis/vm-dependency-graph');

const {
  RequiredProofValidator
} = require('../../packages/core/src/analysis/required-proof-validator');

const {
  TableNode,
  EnvironmentNode,
  ClosureNode,
  CallEdge,
  EnvironmentGraph
} = require('../../packages/core/src/analysis/environment-graph');

const {
  EvaluationOrderGraph
} = require('../../packages/core/src/analysis/evaluation-order-graph');

const {
  Binding,
  ClosureKind,
  MultiReturn,
  MultiReturnKind
} = require('../../packages/core/src/ir/semantic-op');

const {
  chunk,
  identifier,
  callExpression,
  callStatement,
  indexExpression,
  numericLiteral,
  assignmentStatement
} = require('../../packages/core/src/ast/nodes');

function runRound3AuditTests() {
  describe('Round 3 Final Release Gate Integrity Audit Test Suite', () => {

    // 1. P0-1: Empty-input test
    test('1. SemanticASTEmitter refuses empty input and returns complete=false', () => {
      const emitter = new SemanticASTEmitter();
      const res = emitter.emit({
        environmentGraph: {},
        semanticOps: [],
        callGraph: {},
        bindingGraph: {},
        evaluationOrderGraph: {}
      });

      assert.strictEqual(res.complete, false);
      assert.strictEqual(res.reason, 'EMPTY_SEMANTIC_GRAPH');
      assert.strictEqual(res.ast.type, 'Chunk');
      assert.strictEqual(res.ast.body.length, 0);
      assert.strictEqual(res.provenance.length, 0);
      assert.strictEqual(res.identifierProvenance.length, 0);
    });

    // 2. P0-3: Static dependency audit
    test('2. SemanticASTEmitter has zero prohibited static imports or references', () => {
      const filePath = path.resolve(__dirname, '../../packages/core/src/analysis/semantic-ast-emitter.js');
      const content = fs.readFileSync(filePath, 'utf8');

      assert.strictEqual(content.includes("require('fs')"), false, 'Must not import fs');
      assert.strictEqual(content.includes('require("fs")'), false, 'Must not import fs');
      assert.strictEqual(content.includes('original.lua'), false, 'Must not reference original.lua');
      assert.strictEqual(content.includes('expected.lua'), false, 'Must not reference expected.lua');
      assert.strictEqual(content.includes('metadata.json'), false, 'Must not reference metadata.json');
      assert.strictEqual(content.includes('SemanticOracle'), false, 'Must not reference SemanticOracle');
    });

    // 3. Dynamic Return Arity Tests (1, 2, 3, 4, 5 returns)
    for (const arity of [1, 2, 3, 4, 5]) {
      test(`3.${arity} SemanticASTEmitter dynamically derives return arity = ${arity}`, () => {
        const emitter = new SemanticASTEmitter({ identifierNaming: 'neutral' });
        const envGraph = new EnvironmentGraph();
        const env0 = new EnvironmentNode({ envId: 'E0', scopeType: 'ROOT' });
        env0.addBinding(new Binding({ bindingId: 'B_PREFIX', initialValue: 'test' }));
        envGraph.addEnvironment(env0);

        const env1 = new EnvironmentNode({ envId: 'E1', parentEnvId: 'E0', scopeType: 'FACTORY' });
        const t1 = new TableNode({ tableId: 'T1' });
        env1.allocatedTables.set('T1', t1);
        env1.addBinding(new Binding({ bindingId: 'B_COUNT', storage: 'MUTABLE_CELL', initialValue: 0 }));
        envGraph.addEnvironment(env1);
        envGraph.addTable(t1);

        envGraph.addClosure(new ClosureNode({ closureId: 'C_FACTORY', closureKind: ClosureKind.SOURCE_CLOSURE, environmentId: 'E0' }));
        envGraph.addClosure(new ClosureNode({ closureId: 'C_INNER', closureKind: ClosureKind.SOURCE_CLOSURE, environmentId: 'E1' }));

        envGraph.addCall(new CallEdge({ invocationId: 'I1', callee: 'C_FACTORY' }));
        envGraph.addCall(new CallEdge({ invocationId: 'I2', callee: 'C_INNER', args: ['arg1'], returnArity: arity }));

        const res = emitter.emit({ environmentGraph: envGraph });
        assert.strictEqual(res.complete, true);

        // Find the call statement: local r... = inst(...)
        const callStmt = res.ast.body.find(s => s.type === 'LocalStatement' && s.variables[0]?.name?.startsWith('r'));
        assert(callStmt, 'Must emit local multi-assignment statement for closure call');
        assert.strictEqual(callStmt.variables.length, arity, `Assignment variable count must equal return arity ${arity}`);

        // Verify corresponding print statements count
        const printStmts = res.ast.body.filter(s => s.type === 'CallStatement' && s.expression?.base?.name === 'print');
        assert.strictEqual(printStmts.length, arity, `Print statement count must equal return arity ${arity}`);
      });
    }

    test('3.6 SemanticASTEmitter strictly rejects unknown return arity (refuses speculative assignment)', () => {
      const emitter = new SemanticASTEmitter({ identifierNaming: 'neutral' });
      const envGraph = new EnvironmentGraph();
      const env0 = new EnvironmentNode({ envId: 'E0', scopeType: 'ROOT' });
      env0.addBinding(new Binding({ bindingId: 'B_PREFIX', initialValue: 'test' }));
      envGraph.addEnvironment(env0);

      const env1 = new EnvironmentNode({ envId: 'E1', parentEnvId: 'E0', scopeType: 'FACTORY' });
      const t1 = new TableNode({ tableId: 'T1' });
      env1.allocatedTables.set('T1', t1);
      env1.addBinding(new Binding({ bindingId: 'B_COUNT', storage: 'MUTABLE_CELL', initialValue: 0 }));
      envGraph.addEnvironment(env1);
      envGraph.addTable(t1);

      envGraph.addClosure(new ClosureNode({ closureId: 'C_FACTORY', closureKind: ClosureKind.SOURCE_CLOSURE, environmentId: 'E0' }));
      envGraph.addClosure(new ClosureNode({ closureId: 'C_INNER', closureKind: ClosureKind.SOURCE_CLOSURE, environmentId: 'E1' }));

      envGraph.addCall(new CallEdge({ invocationId: 'I1', callee: 'C_FACTORY' }));
      // Return arity is strictly UNKNOWN / UNPROVEN (null, no returnedValues, no MultiReturn SemanticOps)
      envGraph.addCall(new CallEdge({ invocationId: 'I2', callee: 'C_INNER', args: ['arg1'], returnArity: null }));

      const res = emitter.emit({ environmentGraph: envGraph });
      assert.strictEqual(res.complete, false, 'Must not complete when arity is unproven');
      assert.strictEqual(res.reason, 'MULTIRETURN_ARITY_UNPROVEN', 'Must report MULTIRETURN_ARITY_UNPROVEN');
      assert.strictEqual(res.failureCategory, 'MULTIRETURN_ARITY_UNPROVEN');

      // Verify no speculative multi-assignment was emitted
      const multiRetStmt = res.ast.body.find(s => s.type === 'LocalStatement' && s.variables && s.variables.length > 1);
      assert.strictEqual(multiRetStmt, undefined, 'Must not emit speculative multi-assignment');
    });

    // 4. SemanticGraphCompletenessVerifier 9/9 damaged-axis tests
    function createBaseCompleteGraph() {
      const envGraph = new EnvironmentGraph();
      const env0 = new EnvironmentNode({ envId: 'E0', scopeType: 'ROOT' });
      env0.addBinding(new Binding({ bindingId: 'B_PREFIX', storage: 'UPVALUE_CELL' }));
      env0.addBinding(new Binding({ bindingId: 'B_ARGS', storage: 'TABLE_OBJECT' }));
      env0.addBinding(new Binding({ bindingId: 'B_COUNT', storage: 'MUTABLE_CELL' }));
      envGraph.addEnvironment(env0);

      envGraph.addTable(new TableNode({ tableId: 'T1' }));
      envGraph.addClosure(new ClosureNode({ closureId: 'C1', closureKind: ClosureKind.SOURCE_CLOSURE }));
      envGraph.addClosure(new ClosureNode({ closureId: 'C2', closureKind: ClosureKind.SOURCE_CLOSURE }));
      envGraph.addCall(new CallEdge({ invocationId: 1 }));
      envGraph.addCall(new CallEdge({ invocationId: 2 }));

      const eoGraph = new EvaluationOrderGraph();
      eoGraph.addNode('1', 'A');
      eoGraph.addNode('2', 'B');
      eoGraph.addNode('3', 'C');
      eoGraph.addNode('4', 'D');
      eoGraph.addEdge('1', '2');
      eoGraph.addEdge('2', '3');
      eoGraph.addEdge('3', '4');

      const liftedBlocks = new Map([[1, []]]);
      const vmLiftStats = { statefulBranches: 1, multiReturns: 2, varargPacks: 1, calls: 2 };

      return { envGraph, liftedBlocks, vmLiftStats, eoGraph };
    }

    test('4.1 CompletenessVerifier baseline passes all 9 axes', () => {
      const verifier = new SemanticGraphCompletenessVerifier();
      const base = createBaseCompleteGraph();
      const res = verifier.verify({
        environmentGraph: base.envGraph,
        liftedBlocks: base.liftedBlocks,
        vmLiftStats: base.vmLiftStats,
        evaluationOrderGraph: base.eoGraph
      });
      assert.strictEqual(res.complete, true);
      assert.strictEqual(res.sourceClosuresComplete, true);
      assert.strictEqual(res.bindingsComplete, true);
      assert.strictEqual(res.callsComplete, true);
      assert.strictEqual(res.branchesComplete, true);
      assert.strictEqual(res.returnsComplete, true);
      assert.strictEqual(res.tablesComplete, true);
      assert.strictEqual(res.varargsComplete, true);
      assert.strictEqual(res.sideEffectsComplete, true);
      assert.strictEqual(res.evaluationOrderComplete, true);
    });

    test('4.2 CompletenessVerifier axis 1: damaged sourceClosures', () => {
      const verifier = new SemanticGraphCompletenessVerifier();
      const base = createBaseCompleteGraph();
      base.envGraph.closures.delete('C2'); // now only 1
      const res = verifier.verify({ environmentGraph: base.envGraph, liftedBlocks: base.liftedBlocks, vmLiftStats: base.vmLiftStats, evaluationOrderGraph: base.eoGraph });
      assert.strictEqual(res.complete, false);
      assert.strictEqual(res.sourceClosuresComplete, false);
      assert.strictEqual(res.bindingsComplete, true);
    });

    test('4.3 CompletenessVerifier axis 2: damaged bindings', () => {
      const verifier = new SemanticGraphCompletenessVerifier();
      const base = createBaseCompleteGraph();
      base.envGraph.environments.get('E0').bindings.delete('B_COUNT');
      const res = verifier.verify({ environmentGraph: base.envGraph, liftedBlocks: base.liftedBlocks, vmLiftStats: base.vmLiftStats, evaluationOrderGraph: base.eoGraph });
      assert.strictEqual(res.complete, false);
      assert.strictEqual(res.bindingsComplete, false);
      assert.strictEqual(res.sourceClosuresComplete, true);
    });

    test('4.4 CompletenessVerifier axis 3: damaged calls', () => {
      const verifier = new SemanticGraphCompletenessVerifier();
      const base = createBaseCompleteGraph();
      base.envGraph.calls = [];
      const res = verifier.verify({ environmentGraph: base.envGraph, liftedBlocks: base.liftedBlocks, vmLiftStats: base.vmLiftStats, evaluationOrderGraph: base.eoGraph });
      assert.strictEqual(res.complete, false);
      assert.strictEqual(res.callsComplete, false);
    });

    test('4.5 CompletenessVerifier axis 4: damaged branches', () => {
      const verifier = new SemanticGraphCompletenessVerifier();
      const base = createBaseCompleteGraph();
      base.vmLiftStats.statefulBranches = 0;
      const res = verifier.verify({ environmentGraph: base.envGraph, liftedBlocks: base.liftedBlocks, vmLiftStats: base.vmLiftStats, evaluationOrderGraph: base.eoGraph });
      assert.strictEqual(res.complete, false);
      assert.strictEqual(res.branchesComplete, false);
      assert.strictEqual(res.returnsComplete, true);
    });

    test('4.6 CompletenessVerifier axis 5: damaged returns', () => {
      const verifier = new SemanticGraphCompletenessVerifier();
      const base = createBaseCompleteGraph();
      base.vmLiftStats.multiReturns = 0;
      const res = verifier.verify({ environmentGraph: base.envGraph, liftedBlocks: base.liftedBlocks, vmLiftStats: base.vmLiftStats, evaluationOrderGraph: base.eoGraph });
      assert.strictEqual(res.complete, false);
      assert.strictEqual(res.returnsComplete, false);
      assert.strictEqual(res.branchesComplete, true);
    });

    test('4.7 CompletenessVerifier axis 6: damaged tables', () => {
      const verifier = new SemanticGraphCompletenessVerifier();
      const base = createBaseCompleteGraph();
      base.envGraph.tables.clear();
      const res = verifier.verify({ environmentGraph: base.envGraph, liftedBlocks: base.liftedBlocks, vmLiftStats: base.vmLiftStats, evaluationOrderGraph: base.eoGraph });
      assert.strictEqual(res.complete, false);
      assert.strictEqual(res.tablesComplete, false);
    });

    test('4.8 CompletenessVerifier axis 7: damaged varargs', () => {
      const verifier = new SemanticGraphCompletenessVerifier();
      const base = createBaseCompleteGraph();
      base.vmLiftStats.varargPacks = 0;
      const res = verifier.verify({ environmentGraph: base.envGraph, liftedBlocks: base.liftedBlocks, vmLiftStats: base.vmLiftStats, evaluationOrderGraph: base.eoGraph });
      assert.strictEqual(res.complete, false);
      assert.strictEqual(res.varargsComplete, false);
    });

    test('4.9 CompletenessVerifier axis 8: damaged sideEffects', () => {
      const verifier = new SemanticGraphCompletenessVerifier();
      const base = createBaseCompleteGraph();
      base.vmLiftStats.calls = 0;
      base.envGraph.calls = [];
      const res = verifier.verify({ environmentGraph: base.envGraph, liftedBlocks: base.liftedBlocks, vmLiftStats: base.vmLiftStats, evaluationOrderGraph: base.eoGraph });
      assert.strictEqual(res.complete, false);
      assert.strictEqual(res.sideEffectsComplete, false);
    });

    test('4.10 CompletenessVerifier axis 9: damaged evaluationOrder', () => {
      const verifier = new SemanticGraphCompletenessVerifier();
      const base = createBaseCompleteGraph();
      // Add cycle to evaluation order graph: 4 -> 1
      base.eoGraph.addEdge('4', '1');
      assert.strictEqual(base.eoGraph.isAcyclic(), false);
      const res = verifier.verify({ environmentGraph: base.envGraph, liftedBlocks: base.liftedBlocks, vmLiftStats: base.vmLiftStats, evaluationOrderGraph: base.eoGraph });
      assert.strictEqual(res.complete, false);
      assert.strictEqual(res.evaluationOrderComplete, false);
    });

    // 5. VMDependencyGraph negative tests
    test('5.1 VMDependencyGraph detects injected dispatcher variable reference', () => {
      const checker = new VMDependencyGraph();
      const ast = chunk([assignmentStatement([identifier('G')], [numericLiteral(123)])]);
      const res = checker.analyze(ast, 'G');
      assert.strictEqual(res.detached, false);
      assert.strictEqual(res.vmDependency.dispatcherReferences, 1);
    });

    test('5.2 VMDependencyGraph detects injected VM register indexing', () => {
      const checker = new VMDependencyGraph();
      const ast = chunk([assignmentStatement([identifier('x')], [indexExpression(identifier('b'), numericLiteral(1))])]);
      const res = checker.analyze(ast, 'G');
      assert.strictEqual(res.detached, false);
      assert.strictEqual(res.vmDependency.vmRegisterReferences, 1);
    });

    test('5.3 VMDependencyGraph detects injected VM runtime helper or decoder calls', () => {
      const checker = new VMDependencyGraph();
      const ast = chunk([
        callStatement(callExpression(identifier('M'), [numericLiteral(1)])),
        callStatement(callExpression(identifier('H'), [numericLiteral(2)])),
        callStatement(callExpression(identifier('U'), [numericLiteral(3)]))
      ]);
      const res = checker.analyze(ast, 'G');
      assert.strictEqual(res.detached, false);
      assert.strictEqual(res.vmDependency.runtimeHelperReferences, 1);
      assert.strictEqual(res.vmDependency.decoderReferences, 1);
      assert.strictEqual(res.vmDependency.vmTupleTransportReferences, 1);
    });

    // 6. RequiredProofValidator 9/9 adversarial deletion tests
    function createBaseProofBundle() {
      return {
        mixedClosed: {
          invocationCount: 2,
          mutableUpvalueCount: 1,
          varargRecovered: true,
          varargToTableExpansionProven: true,
          closureRecovered: true,
          closureInstanceCount: 1,
          environmentInstanceCount: 1,
          capturedTableIdentityProven: true,
          persistentStateProven: true,
          branchOutcomes: [true, false],
          branchProvenance: { test: true },
          multiReturnExpansionProven: true,
          multiReturnValueCount: 3,
          evaluationOrderProven: true,
          safeWholeProgramReplacement: true
        },
        proofIntegrity: { pass: true }
      };
    }

    test('6.0 RequiredProofValidator baseline passes all 9 proofs', () => {
      const validator = new RequiredProofValidator();
      const res = validator.validate(createBaseProofBundle());
      assert.strictEqual(res.pass, true);
      assert.strictEqual(res.missing.length, 0);
    });

    test('6.1 Deletion 1: VARARG_TABLE_EXPANSION', () => {
      const validator = new RequiredProofValidator();
      const bundle = createBaseProofBundle();
      bundle.mixedClosed.varargToTableExpansionProven = false;
      const res = validator.validate(bundle);
      assert.strictEqual(res.pass, false);
      assert(res.missing.includes('VARARG_TABLE_EXPANSION'));
    });

    test('6.2 Deletion 2: CLOSURE_IDENTITY', () => {
      const validator = new RequiredProofValidator();
      const bundle = createBaseProofBundle();
      bundle.mixedClosed.closureRecovered = false;
      const res = validator.validate(bundle);
      assert.strictEqual(res.pass, false);
      assert(res.missing.includes('CLOSURE_IDENTITY'));
    });

    test('6.3 Deletion 3: ENVIRONMENT_IDENTITY', () => {
      const validator = new RequiredProofValidator();
      const bundle = createBaseProofBundle();
      bundle.mixedClosed.environmentInstanceCount = 0;
      const res = validator.validate(bundle);
      assert.strictEqual(res.pass, false);
      assert(res.missing.includes('ENVIRONMENT_IDENTITY'));
    });

    test('6.4 Deletion 4: CAPTURED_TABLE_IDENTITY', () => {
      const validator = new RequiredProofValidator();
      const bundle = createBaseProofBundle();
      bundle.mixedClosed.capturedTableIdentityProven = false;
      const res = validator.validate(bundle);
      assert.strictEqual(res.pass, false);
      assert(res.missing.includes('CAPTURED_TABLE_IDENTITY'));
    });

    test('6.5 Deletion 5: PERSISTENT_UPVALUE_STATE', () => {
      const validator = new RequiredProofValidator();
      const bundle = createBaseProofBundle();
      bundle.mixedClosed.persistentStateProven = false;
      const res = validator.validate(bundle);
      assert.strictEqual(res.pass, false);
      assert(res.missing.includes('PERSISTENT_UPVALUE_STATE'));
    });

    test('6.6 Deletion 6: STATEFUL_BRANCH', () => {
      const validator = new RequiredProofValidator();
      const bundle = createBaseProofBundle();
      bundle.mixedClosed.branchOutcomes = [];
      const res = validator.validate(bundle);
      assert.strictEqual(res.pass, false);
      assert(res.missing.includes('STATEFUL_BRANCH'));
    });

    test('6.7 Deletion 7: MULTIRETURN', () => {
      const validator = new RequiredProofValidator();
      const bundle = createBaseProofBundle();
      bundle.mixedClosed.multiReturnExpansionProven = false;
      const res = validator.validate(bundle);
      assert.strictEqual(res.pass, false);
      assert(res.missing.includes('MULTIRETURN'));
    });

    test('6.8 Deletion 8: EVALUATION_ORDER', () => {
      const validator = new RequiredProofValidator();
      const bundle = createBaseProofBundle();
      bundle.mixedClosed.evaluationOrderProven = false;
      const res = validator.validate(bundle);
      assert.strictEqual(res.pass, false);
      assert(res.missing.includes('EVALUATION_ORDER'));
    });

    test('6.9 Deletion 9: WHOLE_PROGRAM_REPLACEMENT', () => {
      const validator = new RequiredProofValidator();
      const bundle = createBaseProofBundle();
      bundle.mixedClosed.safeWholeProgramReplacement = false;
      const res = validator.validate(bundle);
      assert.strictEqual(res.pass, false);
      assert(res.missing.includes('WHOLE_PROGRAM_REPLACEMENT'));
    });

    // 7. State Accounting Provenance consistency test
    test('7. State Accounting proves mutation block is 11258761 and distinct from function entry', () => {
      const accountingPath = path.resolve(__dirname, '../../audit/l5w-state-accounting.json');
      assert(fs.existsSync(accountingPath), 'l5w-state-accounting.json must exist');
      const accounting = JSON.parse(fs.readFileSync(accountingPath, 'utf8'));

      const mutationNode = accounting.find(a => a.state === 11258761);
      assert(mutationNode, 'Mutation basic block 11258761 must exist');
      assert.strictEqual(mutationNode.isMutationBlock, true);
      assert.strictEqual(mutationNode.classification, 'MUTABLE_UPVALUE_MUTATION_AND_BRANCH');
      assert(mutationNode.semanticOps.includes('BinaryAdd'));
      assert(mutationNode.semanticOps.includes('UpvalueSet'));
      assert(mutationNode.semanticOps.includes('CompareEq'));
      assert(mutationNode.semanticOps.includes('Branch'));

      // Function entry state must be distinguished
      assert.strictEqual(mutationNode.isFunctionEntry, false);
    });

    // 8. Neutral naming test
    test('8. SemanticASTEmitter supports neutral identifier naming mode', () => {
      const emitter = new SemanticASTEmitter({ identifierNaming: 'neutral' });
      const envGraph = new EnvironmentGraph();
      const env0 = new EnvironmentNode({ envId: 'E0', scopeType: 'ROOT' });
      env0.addBinding(new Binding({ bindingId: 'B_PREFIX', displayName: 'prefix', initialValue: 'hi' }));
      envGraph.addEnvironment(env0);

      const res = emitter.emit({ environmentGraph: envGraph });
      assert.strictEqual(res.complete, true);
      assert(res.identifierProvenance.length > 0);
      assert.strictEqual(res.identifierProvenance[0].outputName, 'v1');
      assert.strictEqual(res.identifierProvenance[0].bindingId, 'B_PREFIX');
      assert.strictEqual(res.identifierProvenance[0].nameSource, 'GENERATED_NAME');
    });

  });
}

module.exports = { runRound3AuditTests };
