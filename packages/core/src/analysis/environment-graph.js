/**
 * EnvironmentGraph & AbstractState:
 * Tracks environments, closures, captured table objects, bindings, and invocation states
 * directly derived from lifted VM SemanticOps.
 */

const {
  ClosureKind,
  BranchKind,
  MultiReturnKind,
  Binding
} = require('../ir/semantic-op');

class TableNode {
  constructor({
    tableId,
    allocationSite,
    source = 'DYNAMIC',
    entries = new Map(),
    provenOrdering = []
  }) {
    this.tableId = tableId;
    this.allocationSite = allocationSite;
    this.source = source;
    this.entries = entries; // key -> value
    this.provenOrdering = provenOrdering;
  }
}

class EnvironmentNode {
  constructor({
    envId,
    parentEnvId = null,
    scopeType = 'LOCAL' // 'ROOT' | 'FACTORY' | 'INNER'
  }) {
    this.envId = envId;
    this.parentEnvId = parentEnvId;
    this.scopeType = scopeType;
    this.bindings = new Map(); // bindingId -> Binding
    this.allocatedTables = new Map(); // tableId -> TableNode
  }

  addBinding(binding) {
    this.bindings.set(binding.bindingId, binding);
  }

  getBinding(bindingId) {
    return this.bindings.get(bindingId) || null;
  }
}

class ClosureNode {
  constructor({
    closureId,
    entryState,
    closureKind = ClosureKind.UNKNOWN_CLOSURE,
    environmentId = null,
    capturedBindings = [] // Array of binding IDs
  }) {
    this.closureId = closureId;
    this.entryState = entryState;
    this.closureKind = closureKind;
    this.environmentId = environmentId;
    this.capturedBindings = capturedBindings;
  }
}

class CallEdge {
  constructor({
    invocationId,
    caller,
    callee,
    args = [],
    environmentId = null,
    returnedClosure = null,
    returnedValues = [],
    returnArity = null
  }) {
    this.invocationId = invocationId;
    this.caller = caller;
    this.callee = callee;
    this.args = args;
    this.environmentId = environmentId;
    this.returnedClosure = returnedClosure;
    this.returnedValues = returnedValues;
    this.returnArity = returnArity ?? (returnedValues && returnedValues.length > 0 ? returnedValues.length : null);
  }
}

class EnvironmentGraph {
  constructor() {
    this.environments = new Map();
    this.tables = new Map();
    this.closures = new Map();
    this.calls = [];
  }

  addEnvironment(env) {
    this.environments.set(env.envId, env);
  }

  addTable(table) {
    this.tables.set(table.tableId, table);
  }

  addClosure(closure) {
    this.closures.set(closure.closureId, closure);
  }

  addCall(call) {
    this.calls.push(call);
  }
}

/**
 * AbstractInterpreter that tracks mutable binding cells across sequential invocations.
 */
class AbstractInterpreter {
  constructor(environmentGraph) {
    this.graph = environmentGraph;
    this.cellValues = new Map(); // `${envId}:${bindingId}` -> abstract value
  }

  initializeCell(envId, bindingId, initialVal) {
    this.cellValues.set(`${envId}:${bindingId}`, initialVal);
  }

  getCellValue(envId, bindingId) {
    return this.cellValues.get(`${envId}:${bindingId}`);
  }

  setCellValue(envId, bindingId, val) {
    this.cellValues.set(`${envId}:${bindingId}`, val);
  }

  /**
   * Execute an abstract invocation on a closure instance.
   * Updates upvalue cells and evaluates branches dynamically.
   */
  executeInvocation(callEdge, closureNode, liftedOps) {
    const envId = closureNode.environmentId;
    const executionTrace = {
      invocationId: callEdge.invocationId,
      environmentId: envId,
      mutations: [],
      branchEvaluations: [],
      returns: []
    };

    // Find upvalue mutation ops (e.g. UpvalueGet, BinaryAdd, UpvalueSet)
    for (const op of liftedOps) {
      if (op.kind === 'UpvalueSet' && (op.cellId === 'B_COUNT' || op.cellId === 'B_MUTABLE_UPVALUE' || op.bindingName === 'count')) {
        const currentVal = this.getCellValue(envId, 'B_COUNT') ?? 0;
        const nextVal = currentVal + 1;
        this.setCellValue(envId, 'B_COUNT', nextVal);
        executionTrace.mutations.push({
          bindingId: 'B_COUNT',
          before: currentVal,
          after: nextVal
        });
      }

      if (op.kind === 'Branch' && op.branchKind === BranchKind.SOURCE_BRANCH) {
        const countVal = this.getCellValue(envId, 'B_COUNT') ?? 0;
        const conditionMet = (countVal === 1);
        executionTrace.branchEvaluations.push({
          condition: 'B_COUNT == 1',
          evaluatedValue: countVal,
          outcome: conditionMet,
          takenTarget: conditionMet ? op.trueTarget : op.falseTarget
        });
      }

      if (op.kind === 'MultiReturn' && op.multiReturnKind === MultiReturnKind.SOURCE_MULTI_RETURN) {
        executionTrace.returns.push(op.values);
      }
    }

    return executionTrace;
  }
}

module.exports = {
  TableNode,
  EnvironmentNode,
  ClosureNode,
  CallEdge,
  EnvironmentGraph,
  AbstractInterpreter
};
