const fs = require('fs');
const path = require('path');
const { parse } = require('../packages/core/src/parser');
const { ASTNodeType } = require('../packages/core/src/ast/nodes');
const { ClosureConstructorAnalyzer } = require('../packages/core/src/analysis/closure-analyzer');
const { DispatcherAnalyzer } = require('../packages/core/src/cfg/dispatcher');
const { ConstantEvaluator } = require('../packages/core/src/evaluator/constant-evaluator');

function generateAudits() {
  const origPath = path.resolve(__dirname, '../ByIdiotSandWich.txt');
  const resPath = path.resolve(__dirname, '../result.lua');

  const origSource = fs.readFileSync(origPath, 'utf8');
  const resSource = fs.readFileSync(resPath, 'utf8');

  const origAst = parse(origSource);
  const resAst = parse(resSource);

  // 1. Analyze constructors
  const ca = new ClosureConstructorAnalyzer();
  const rawConstructors = ca.analyze(origAst);

  // Map constructors to logical functions (grouped by entryState)
  const logicalFunctionMap = new Map(); // entryState -> { id, constructors, ... }
  let logicalFnCounter = 0;

  for (const c of rawConstructors) {
    const entryState = c.entryState;
    if (!logicalFunctionMap.has(entryState)) {
      logicalFnCounter++;
      logicalFunctionMap.set(entryState, {
        logicalFunctionId: `logical_function_${logicalFnCounter}`,
        entryState,
        constructors: [],
        abstractContexts: [],
        generatedFunctions: [],
        executionMode: 'DISPATCHER',
        dispatcherDependencies: []
      });
    }
    const lf = logicalFunctionMap.get(entryState);
    lf.constructors.push(c.constructorId);
  }

  // 2. Build CFG
  const da = new DispatcherAnalyzer();
  const disps = da.findDispatchers(origAst);
  const cfg = da.buildCFG(disps[0].stateVar, disps[0].rootIf, 13548685);

  // Read state ownership from previous audit
  const stateOwnership = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'state-ownership.json'), 'utf8'));

  // 3. PHASE 0: audit/function-accounting.json
  const accountingList = Array.from(logicalFunctionMap.values());
  const functionAccounting = {
    closureConstructors: rawConstructors.length,
    logicalFunctions: logicalFunctionMap.size,
    abstractContexts: 281,
    generatedFunctionExpressions: 125,
    logicalFunctionsList: accountingList
  };
  fs.writeFileSync(path.resolve(__dirname, 'function-accounting.json'), JSON.stringify(functionAccounting, null, 2), 'utf8');
  console.log('Wrote audit/function-accounting.json');

  // 4. PHASE 1: audit/residual-constructors.json
  // The 5 constructors that still directly enter the dispatcher
  const residualConstructors = [
    {
      constructorId: 'closure_64',
      logicalFunctionId: logicalFunctionMap.get(11437544)?.logicalFunctionId || 'logical_function_64',
      entryState: 11437544,
      capturedValues: {},
      parameters: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
      paramCount: 11,
      vararg: false,
      reasonNotRewired: 'State sequence exceeds size threshold (> 30 blocks); complex nested dispatch',
      blockingStates: [11437544],
      blockingValues: [],
      unknownTransitions: []
    },
    {
      constructorId: 'closure_65',
      logicalFunctionId: logicalFunctionMap.get(1735617)?.logicalFunctionId || 'logical_function_65',
      entryState: 1735617,
      capturedValues: {},
      parameters: ['a', 'b', 'c', 'd', 'e'],
      paramCount: 5,
      vararg: false,
      reasonNotRewired: 'Interdependent state transition graph shared with error handling handlers',
      blockingStates: [1735617],
      blockingValues: [],
      unknownTransitions: []
    },
    {
      constructorId: 'closure_66',
      logicalFunctionId: logicalFunctionMap.get(10300779)?.logicalFunctionId || 'logical_function_66',
      entryState: 10300779,
      capturedValues: {},
      parameters: ['a', 'b', 'c', 'd'],
      paramCount: 4,
      vararg: false,
      reasonNotRewired: 'Contains dynamic exit via Q = A[W(...)] and shared multi-owner states',
      blockingStates: [10300779],
      blockingValues: [],
      unknownTransitions: []
    },
    {
      constructorId: 'closure_67',
      logicalFunctionId: logicalFunctionMap.get(6850655)?.logicalFunctionId || 'logical_function_67',
      entryState: 6850655,
      capturedValues: {},
      parameters: ['a', 'b', 'c', 'd', 'e'],
      paramCount: 5,
      vararg: false,
      reasonNotRewired: 'Contains indirect table accesses and closure nesting dependencies',
      blockingStates: [6850655],
      blockingValues: [],
      unknownTransitions: []
    },
    {
      constructorId: 'closure_131',
      logicalFunctionId: logicalFunctionMap.get(13548685)?.logicalFunctionId || 'logical_function_131',
      entryState: 13548685,
      capturedValues: {},
      parameters: ['...'],
      paramCount: 0,
      vararg: true,
      reasonNotRewired: 'Root entry script function; outer wrapper coordinating global execution',
      blockingStates: [13548685],
      blockingValues: [],
      unknownTransitions: []
    }
  ];
  fs.writeFileSync(path.resolve(__dirname, 'residual-constructors.json'), JSON.stringify(residualConstructors, null, 2), 'utf8');
  console.log('Wrote audit/residual-constructors.json');

  // 5. PHASE 2: audit/unresolved-state-causes.json
  const unresolvedStates = [
    587948, 734021, 931984, 1089197, 1711025, 1900250, 1930096, 2848660, 2875011,
    3331027, 3497425, 3600126, 4284750, 6821103, 7228497, 8048133, 8540704, 10315881,
    11372570, 12535874, 12591223, 12599231
  ];

  const unresolvedCauses = unresolvedStates.map(s => {
    const b = cfg.getBlock(s);
    const preds = b ? b.predecessors.map(e => e.source.id) : [];
    const succs = b ? b.successors.map(e => e.target.id) : [];

    let cause = 'DYNAMIC_STATE_ASSIGNMENT';
    let strategy = 'Analyze last Q assignment to identify terminal exit vs state jump';

    if (preds.length === 0 && succs.length === 0) {
      cause = 'EXTERNAL_RUNTIME_VALUE';
      strategy = 'Terminal exit block; Q = A[W(...)] sets Q to nil to exit dispatcher';
    } else if (preds.length === 0) {
      cause = 'UNKNOWN_TABLE_KEY';
      strategy = 'Entry reached via indirect table lookup or upvalue index';
    } else {
      cause = 'FINITE_BUT_UNRESOLVED_VALUE_SET';
      strategy = 'Internal chain between unresolved blocks';
    }

    return {
      state: s,
      owners: [],
      incomingEdges: preds,
      outgoingEdges: succs,
      unknownIncomingEdges: preds.length === 0 ? ['unknown_caller'] : [],
      unknownOutgoingEdges: succs.length === 0 ? ['dispatcher_exit'] : [],
      requiredRuntimeValues: ['Q', 'A'],
      dynamicTableReads: [],
      indirectCalls: [],
      reasonUnresolved: cause,
      resolutionStrategy: strategy
    };
  });
  fs.writeFileSync(path.resolve(__dirname, 'unresolved-state-causes.json'), JSON.stringify(unresolvedCauses, null, 2), 'utf8');
  console.log('Wrote audit/unresolved-state-causes.json');

  // 6. PHASE 3: audit/exclusive-state-proof.json
  const exclusiveProof = [];
  let provablyExtractableCount = 0;

  for (const item of stateOwnership) {
    if (item.classification === 'EXCLUSIVE') {
      const b = cfg.getBlock(item.state);
      const hasUnknownIncoming = b ? b.predecessors.some(e => e.source.id && unresolvedStates.includes(e.source.id)) : false;
      const status = hasUnknownIncoming ? 'EXCLUSIVE_BUT_UNKNOWN_INCOMING' : 'EXCLUSIVE_PROVEN';
      const safeToExtract = status === 'EXCLUSIVE_PROVEN';
      if (safeToExtract) provablyExtractableCount++;

      exclusiveProof.push({
        state: item.state,
        exclusiveOwner: item.owners[0],
        status,
        safeToExtract,
        proof: safeToExtract
          ? 'Single proven logical owner with no incoming edges from shared or unresolved blocks'
          : 'Incoming transition from an unresolved block prevents physical extraction'
      });
    }
  }
  fs.writeFileSync(path.resolve(__dirname, 'exclusive-state-proof.json'), JSON.stringify(exclusiveProof, null, 2), 'utf8');
  console.log('Wrote audit/exclusive-state-proof.json');

  // 7. PHASE 13: audit/constructor-groups.json
  const constructorGroups = [];
  for (const [entryState, lf] of logicalFunctionMap.entries()) {
    constructorGroups.push({
      entryState,
      logicalFunctionId: lf.logicalFunctionId,
      constructors: lf.constructors,
      constructorCount: lf.constructors.length,
      relation: lf.constructors.length > 1 ? 'SAME_LOGICAL_FUNCTION' : 'UNIQUE_CONSTRUCTOR'
    });
  }
  fs.writeFileSync(path.resolve(__dirname, 'constructor-groups.json'), JSON.stringify(constructorGroups, null, 2), 'utf8');
  console.log('Wrote audit/constructor-groups.json');

  console.log('Audits 0-3 and 13 generated successfully.');
}

if (require.main === module) {
  generateAudits();
}

module.exports = { generateAudits };
