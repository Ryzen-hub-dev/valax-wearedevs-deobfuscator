/**
 * FunctionContext represents an isolated function/closure invocation context
 * mapped to one or more entry points into the shared state machine.
 */
class FunctionContext {
  constructor(options = {}) {
    this.id = options.id; // e.g. "func_1", "closure_17"
    this.name = options.name || `func_${this.id}`;
    this.constructorId = options.constructorId || null;
    this.helper = options.helper || null;
    this.entryState = options.entryState !== undefined ? options.entryState : null;
    this.parameters = options.parameters || [];
    this.paramCount = options.paramCount || 0;
    this.isVararg = !!options.vararg;
    this.capturedUpvalues = options.capturedUpvalues || []; // Array of upvalue descriptors
    this.knownCallSites = [];
    this.unknownCallSites = [];
    this.reachableStates = new Set(); // PROVEN reachable states
    this.conditionalStates = new Set(); // CONDITIONALLY reachable states
    this.unresolvedStates = new Set(); // UNRESOLVED states
    this.returnStates = new Set(); // States that execute a return statement
    this.sccs = []; // Strongly connected components in this function
    this.dominators = new Map(); // state -> dominator set
    this.immediateDominators = new Map(); // state -> idom
    this.structuredRegion = null; // Reconstructed structured AST if available
  }

  addReachableState(stateId, type = 'PROVEN') {
    if (type === 'PROVEN') {
      this.reachableStates.add(stateId);
    } else if (type === 'CONDITIONAL') {
      this.conditionalStates.add(stateId);
    } else {
      this.unresolvedStates.add(stateId);
    }
  }

  addReturnState(stateId) {
    this.returnStates.add(stateId);
  }

  addCallSite(callSite) {
    if (callSite.isResolved) {
      this.knownCallSites.push(callSite);
    } else {
      this.unknownCallSites.push(callSite);
    }
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      constructorId: this.constructorId,
      helper: this.helper,
      entryState: this.entryState,
      parameters: this.parameters,
      paramCount: this.paramCount,
      isVararg: this.isVararg,
      capturedUpvalues: this.capturedUpvalues,
      knownCallSitesCount: this.knownCallSites.length,
      unknownCallSitesCount: this.unknownCallSites.length,
      reachableStates: Array.from(this.reachableStates),
      conditionalStates: Array.from(this.conditionalStates),
      unresolvedStates: Array.from(this.unresolvedStates),
      returnStates: Array.from(this.returnStates)
    };
  }
}

module.exports = { FunctionContext };
