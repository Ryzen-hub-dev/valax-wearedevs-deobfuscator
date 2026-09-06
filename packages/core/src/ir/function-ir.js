/**
 * High-level Intermediate Representation (IR) for separated function regions.
 */

class IRNode {
  constructor(kind) {
    this.kind = kind;
  }
}

class ProgramIR extends IRNode {
  constructor() {
    super('ProgramIR');
    this.topLevelStatements = [];
    this.functions = []; // Array of FunctionIR
    this.sharedDispatcher = null; // Shared dispatcher if required for unresolved states
  }
}

class FunctionIR extends IRNode {
  constructor(id, name, params = [], isVararg = false) {
    super('FunctionIR');
    this.id = id;
    this.name = name;
    this.params = params;
    this.isVararg = isVararg;
    this.upvalues = [];
    this.regions = []; // Array of StructuredRegion | UnstructuredRegion
    this.returnType = 'unknown';
  }
}

class BasicBlockIR extends IRNode {
  constructor(id, statements = []) {
    super('BasicBlockIR');
    this.id = id;
    this.statements = statements; // AST statements inside this block
  }
}

class StructuredRegion extends IRNode {
  constructor(type, body = [], condition = null, elseBody = null) {
    super('StructuredRegion');
    this.type = type; // 'sequence' | 'if_then_else' | 'while_loop' | 'repeat_loop'
    this.body = body; // Array of IRNode / AST statements
    this.condition = condition;
    this.elseBody = elseBody;
  }
}

class UnstructuredRegion extends IRNode {
  constructor(blocks = [], entryState = null) {
    super('UnstructuredRegion');
    this.blocks = blocks; // Array of BasicBlockIR
    this.entryState = entryState;
  }
}

class CallIR extends IRNode {
  constructor(callee, args = []) {
    super('CallIR');
    this.callee = callee;
    this.args = args;
  }
}

class ReturnIR extends IRNode {
  constructor(expressions = []) {
    super('ReturnIR');
    this.expressions = expressions;
  }
}

const ValueOrigin = {
  FUNCTION_RETURN: 'FUNCTION_RETURN',
  VARARG: 'VARARG',
  CONSTANT: 'CONSTANT',
  UNKNOWN: 'UNKNOWN'
};

/**
 * ValueFlow representations for exact Lua multi-return and vararg semantics.
 */
class ValueFlow extends IRNode {
  constructor(kind, origin = ValueOrigin.UNKNOWN) {
    super(kind);
    this.origin = origin;
  }
}

class SingleValue extends ValueFlow {
  constructor(value, origin = ValueOrigin.CONSTANT) {
    super('SingleValue', origin);
    this.value = value;
  }
}

class MultiValue extends ValueFlow {
  constructor(values = [], origin = ValueOrigin.FUNCTION_RETURN) {
    super('MultiValue', origin);
    this.values = values;
  }

  getCount() {
    return this.values.length;
  }

  getFirst() {
    return this.values.length > 0 ? this.values[0] : null;
  }
}

class UnknownMultiValue extends ValueFlow {
  constructor(minCount = 0, origin = ValueOrigin.UNKNOWN) {
    super('UnknownMultiValue', origin);
    this.minCount = minCount;
  }
}

class VarargValue extends SingleValue {
  constructor(value, index = 0) {
    super(value, ValueOrigin.VARARG);
    this.kind = 'VarargValue';
    this.index = index;
  }
}

class VarargMultiValue extends MultiValue {
  constructor(values = []) {
    super(values, ValueOrigin.VARARG);
    this.kind = 'VarargMultiValue';
  }
}

class UnknownVararg extends UnknownMultiValue {
  constructor(minCount = 0) {
    super(minCount, ValueOrigin.VARARG);
    this.kind = 'UnknownVararg';
  }
}

const ContextKind = {
  ASSIGNMENT_TAIL: 'ASSIGNMENT_TAIL',
  ASSIGNMENT_NON_TAIL: 'ASSIGNMENT_NON_TAIL',
  RETURN_TAIL: 'RETURN_TAIL',
  RETURN_NON_TAIL: 'RETURN_NON_TAIL',
  CALL_ARG_TAIL: 'CALL_ARG_TAIL',
  CALL_ARG_NON_TAIL: 'CALL_ARG_NON_TAIL',
  PARENTHESIZED: 'PARENTHESIZED',
  EXPRESSION_SINGLE: 'EXPRESSION_SINGLE'
};

class TupleFlow {
  /**
   * Adjust multi-value flow based on syntactic context according to Lua rules.
   * Unified for both function-return MultiValue and vararg MultiValue.
   * @param {ValueFlow} valueFlow
   * @param {string} context - ContextKind
   * @param {number} [targetCount=1] - Number of target variables for assignment context
   * @returns {ValueFlow}
   */
  static adjustForContext(valueFlow, context, targetCount = 1) {
    if (valueFlow instanceof SingleValue) {
      return valueFlow;
    }

    if (valueFlow instanceof UnknownMultiValue) {
      if (
        context === ContextKind.ASSIGNMENT_NON_TAIL ||
        context === ContextKind.RETURN_NON_TAIL ||
        context === ContextKind.CALL_ARG_NON_TAIL ||
        context === ContextKind.PARENTHESIZED ||
        context === ContextKind.EXPRESSION_SINGLE
      ) {
        return valueFlow.origin === ValueOrigin.VARARG ? new VarargValue(null, 0) : new SingleValue(null, valueFlow.origin);
      }
      return valueFlow;
    }

    if (valueFlow instanceof MultiValue) {
      const isVararg = valueFlow.origin === ValueOrigin.VARARG || valueFlow instanceof VarargMultiValue;

      switch (context) {
        case ContextKind.PARENTHESIZED:
        case ContextKind.EXPRESSION_SINGLE:
        case ContextKind.ASSIGNMENT_NON_TAIL:
        case ContextKind.RETURN_NON_TAIL:
        case ContextKind.CALL_ARG_NON_TAIL: {
          const first = valueFlow.values.length > 0 ? valueFlow.values[0] : null;
          return isVararg ? new VarargValue(first, 0) : new SingleValue(first, valueFlow.origin);
        }

        case ContextKind.ASSIGNMENT_TAIL: {
          const adjusted = [];
          for (let i = 0; i < targetCount; i++) {
            if (i < valueFlow.values.length) {
              adjusted.push(valueFlow.values[i]);
            } else {
              adjusted.push(isVararg ? new VarargValue(null, i) : null);
            }
          }
          return isVararg ? new VarargMultiValue(adjusted) : new MultiValue(adjusted, valueFlow.origin);
        }

        case ContextKind.RETURN_TAIL:
        case ContextKind.CALL_ARG_TAIL:
          return valueFlow;

        default:
          return valueFlow;
      }
    }

    return valueFlow;
  }
}

/**
 * Formal IR representations for lexical binding, closure capture, and upvalues.
 */
class LocalBinding extends IRNode {
  constructor(id, name, scopeId, initialValue = null) {
    super('LocalBinding');
    this.id = id;
    this.name = name;
    this.scopeId = scopeId;
    this.initialValue = initialValue;
    this.mutations = []; // Array of { value, loc, scopeId }
    this.readers = []; // Array of { loc, scopeId }
    this.escapes = false;
  }

  addMutation(value, loc = null, scopeId = null) {
    this.mutations.push({ value, loc, scopeId });
  }

  addReader(loc = null, scopeId = null) {
    this.readers.push({ loc, scopeId });
  }
}

class CapturedBinding extends IRNode {
  constructor(bindingId, name, sourceScopeId, capturedByScopeId) {
    super('CapturedBinding');
    this.bindingId = bindingId;
    this.name = name;
    this.sourceScopeId = sourceScopeId;
    this.capturedByScopeId = capturedByScopeId;
    this.isReference = true; // Lua semantics: captures lexical binding reference, not value copy
  }
}

class UpvalueRead extends IRNode {
  constructor(bindingId, name, loc = null, scopeId = null) {
    super('UpvalueRead');
    this.bindingId = bindingId;
    this.name = name;
    this.loc = loc;
    this.scopeId = scopeId;
  }
}

class UpvalueWrite extends IRNode {
  constructor(bindingId, name, value, loc = null, scopeId = null) {
    super('UpvalueWrite');
    this.bindingId = bindingId;
    this.name = name;
    this.value = value;
    this.loc = loc;
    this.scopeId = scopeId;
  }
}

class ClosureEnvironment extends IRNode {
  constructor(id, scopeId, parentEnvId = null) {
    super('ClosureEnvironment');
    this.id = id;
    this.scopeId = scopeId;
    this.parentEnvId = parentEnvId;
    this.bindings = new Map(); // bindingId -> LocalBinding
    this.escapes = false;
  }

  defineBinding(binding) {
    this.bindings.set(binding.id, binding);
  }

  getBinding(bindingId) {
    return this.bindings.get(bindingId) || null;
  }
}

module.exports = {
  IRNode,
  ProgramIR,
  FunctionIR,
  BasicBlockIR,
  StructuredRegion,
  UnstructuredRegion,
  CallIR,
  ReturnIR,
  ValueOrigin,
  ValueFlow,
  SingleValue,
  MultiValue,
  UnknownMultiValue,
  VarargValue,
  VarargMultiValue,
  UnknownVararg,
  ContextKind,
  TupleFlow,
  LocalBinding,
  CapturedBinding,
  UpvalueRead,
  UpvalueWrite,
  ClosureEnvironment,
  ...require('./semantic-op')
};

