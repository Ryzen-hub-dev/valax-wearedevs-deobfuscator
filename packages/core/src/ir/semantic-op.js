/**
 * SemanticOp IR: Formal intermediate representation bridging
 * obfuscated VM basic blocks and high-level abstract program structures.
 */

const SemanticOpKind = {
  LOCAL_SET: 'LocalSet',
  LOCAL_GET: 'LocalGet',
  UPVALUE_GET: 'UpvalueGet',
  UPVALUE_SET: 'UpvalueSet',
  VARARG_GET: 'VarargGet',
  VARARG_PACK: 'VarargPack',
  TABLE_NEW: 'TableNew',
  TABLE_SET: 'TableSet',
  TABLE_GET: 'TableGet',
  CLOSURE_NEW: 'ClosureNew',
  ENVIRONMENT_NEW: 'EnvironmentNew',
  CALL: 'Call',
  RETURN: 'Return',
  MULTI_RETURN: 'MultiReturn',
  BINARY_ADD: 'BinaryAdd',
  COMPARE_EQ: 'CompareEq',
  BRANCH: 'Branch'
};

const ClosureKind = {
  SOURCE_CLOSURE: 'SOURCE_CLOSURE',
  VM_HELPER_CLOSURE: 'VM_HELPER_CLOSURE',
  RUNTIME_WRAPPER: 'RUNTIME_WRAPPER',
  UNKNOWN_CLOSURE: 'UNKNOWN_CLOSURE'
};

const BranchKind = {
  SOURCE_BRANCH: 'SOURCE_BRANCH',
  VM_DISPATCH_BRANCH: 'VM_DISPATCH_BRANCH',
  RUNTIME_BRANCH: 'RUNTIME_BRANCH',
  UNKNOWN_BRANCH: 'UNKNOWN_BRANCH'
};

const MultiReturnKind = {
  SOURCE_MULTI_RETURN: 'SOURCE_MULTI_RETURN',
  VM_TUPLE_TRANSPORT: 'VM_TUPLE_TRANSPORT',
  CALL_RESULT_PACK: 'CALL_RESULT_PACK',
  UNKNOWN_MULTI_VALUE: 'UNKNOWN_MULTI_VALUE'
};

class SemanticOpProvenance {
  constructor({
    opId,
    type,
    originState,
    originStatements = [],
    bindingId = null,
    environmentId = null,
    confidence = 'PROVEN_STATIC',
    proofSource = 'VM_IR',
    justification = ''
  }) {
    const prohibitedSources = new Set([
      'SEMANTIC_TRACE',
      'ORIGINAL_SOURCE',
      'EXPECTED_SOURCE',
      'FIXTURE_METADATA'
    ]);
    if (prohibitedSources.has(proofSource)) {
      throw new Error(`Prohibited proofSource in SemanticOpProvenance: ${proofSource}`);
    }
    this.opId = opId;
    this.type = type;
    this.originState = originState;
    this.originStatements = originStatements;
    this.bindingId = bindingId;
    this.environmentId = environmentId;
    this.confidence = confidence;
    this.proofSource = proofSource;
    this.justification = justification;
  }
}

class Binding {
  constructor({
    bindingId,
    displayName = null,
    storage = 'REGISTER', // 'REGISTER' | 'UPVALUE_CELL' | 'TABLE_OBJECT' | 'MUTABLE_CELL'
    environmentId = null,
    owner = null,
    allocationSite = null,
    initialValue = null,
    reads = [],
    writes = [],
    captures = []
  }) {
    this.bindingId = bindingId;
    this.displayName = displayName;
    this.storage = storage;
    this.environmentId = environmentId;
    this.owner = owner;
    this.allocationSite = allocationSite;
    this.initialValue = initialValue;
    this.reads = reads;
    this.writes = writes;
    this.captures = captures;
  }
}

class SemanticOp {
  constructor(kind, stateId = null, provenance = null) {
    this.kind = kind;
    this.stateId = stateId;
    this.provenance = provenance;
  }
}

class LocalSet extends SemanticOp {
  constructor(target, value, stateId = null) {
    super(SemanticOpKind.LOCAL_SET, stateId);
    this.target = target;
    this.value = value;
  }
}

class LocalGet extends SemanticOp {
  constructor(source, stateId = null) {
    super(SemanticOpKind.LOCAL_GET, stateId);
    this.source = source;
  }
}

class UpvalueGet extends SemanticOp {
  constructor(cellId, bindingName = null, stateId = null) {
    super(SemanticOpKind.UPVALUE_GET, stateId);
    this.cellId = cellId;
    this.bindingName = bindingName;
  }
}

class UpvalueSet extends SemanticOp {
  constructor(cellId, value, bindingName = null, stateId = null) {
    super(SemanticOpKind.UPVALUE_SET, stateId);
    this.cellId = cellId;
    this.value = value;
    this.bindingName = bindingName;
  }
}

class VarargGet extends SemanticOp {
  constructor(stateId = null, provenance = null) {
    super(SemanticOpKind.VARARG_GET, stateId, provenance);
  }
}

class TableNew extends SemanticOp {
  constructor(target, elements = [], stateId = null) {
    super(SemanticOpKind.TABLE_NEW, stateId);
    this.target = target;
    this.elements = elements;
  }
}

class TableSet extends SemanticOp {
  constructor(table, key, value, stateId = null) {
    super(SemanticOpKind.TABLE_SET, stateId);
    this.table = table;
    this.key = key;
    this.value = value;
  }
}

class TableGet extends SemanticOp {
  constructor(target, table, key, stateId = null) {
    super(SemanticOpKind.TABLE_GET, stateId);
    this.target = target;
    this.table = table;
    this.key = key;
  }
}

class VarargPack extends SemanticOp {
  constructor(target = 'args', stateId = null, varargProof = null, provenance = null) {
    super(SemanticOpKind.VARARG_PACK, stateId, provenance);
    this.target = target;
    this.varargProof = varargProof;
  }
}

class ClosureNew extends SemanticOp {
  constructor(target, entryState, capturedCells = [], helper = null, stateId = null, closureKind = ClosureKind.UNKNOWN_CLOSURE, provenance = null) {
    super(SemanticOpKind.CLOSURE_NEW, stateId, provenance);
    this.target = target;
    this.entryState = entryState;
    this.capturedCells = capturedCells;
    this.helper = helper;
    this.closureKind = closureKind;
  }
}

class EnvironmentNew extends SemanticOp {
  constructor(envId, parentEnvId = null, stateId = null, provenance = null) {
    super(SemanticOpKind.ENVIRONMENT_NEW, stateId, provenance);
    this.envId = envId;
    this.parentEnvId = parentEnvId;
    this.bindings = new Map();
  }
}

class Call extends SemanticOp {
  constructor(target, callee, args = [], stateId = null, provenance = null) {
    super(SemanticOpKind.CALL, stateId, provenance);
    this.target = target;
    this.callee = callee;
    this.args = args;
  }
}

class Return extends SemanticOp {
  constructor(values = [], stateId = null, provenance = null) {
    super(SemanticOpKind.RETURN, stateId, provenance);
    this.values = values;
  }
}

class MultiReturn extends SemanticOp {
  constructor(values = [], stateId = null, multiReturnKind = MultiReturnKind.UNKNOWN_MULTI_VALUE, provenance = null) {
    super(SemanticOpKind.MULTI_RETURN, stateId, provenance);
    this.values = values;
    this.multiReturnKind = multiReturnKind;
  }
}

class BinaryAdd extends SemanticOp {
  constructor(target, left, right, stateId = null, provenance = null) {
    super(SemanticOpKind.BINARY_ADD, stateId, provenance);
    this.target = target;
    this.left = left;
    this.right = right;
  }
}

class CompareEq extends SemanticOp {
  constructor(target, left, right, stateId = null, provenance = null) {
    super(SemanticOpKind.COMPARE_EQ, stateId, provenance);
    this.target = target;
    this.left = left;
    this.right = right;
  }
}

class Branch extends SemanticOp {
  constructor(condition, trueTarget, falseTarget, stateId = null, branchKind = BranchKind.UNKNOWN_BRANCH, provenance = null) {
    super(SemanticOpKind.BRANCH, stateId, provenance);
    this.condition = condition;
    this.trueTarget = trueTarget;
    this.falseTarget = falseTarget;
    this.branchKind = branchKind;
  }
}

module.exports = {
  SemanticOpKind,
  ClosureKind,
  BranchKind,
  MultiReturnKind,
  SemanticOpProvenance,
  Binding,
  SemanticOp,
  LocalSet,
  LocalGet,
  UpvalueGet,
  UpvalueSet,
  VarargGet,
  VarargPack,
  TableNew,
  TableSet,
  TableGet,
  ClosureNew,
  EnvironmentNew,
  Call,
  Return,
  MultiReturn,
  BinaryAdd,
  CompareEq,
  Branch
};
