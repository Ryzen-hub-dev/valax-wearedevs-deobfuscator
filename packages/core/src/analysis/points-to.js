const { ASTNodeType } = require('../ast/nodes');

class AbstractValue {
  constructor(kind) {
    this.kind = kind;
  }
}

class UnknownValue extends AbstractValue {
  constructor(reason = 'unknown') {
    super('UnknownValue');
    this.reason = reason;
  }
}

class PrimitiveValue extends AbstractValue {
  constructor(type, value) {
    super('PrimitiveValue');
    this.primitiveType = type;
    this.value = value;
  }
}

class FunctionSet extends AbstractValue {
  constructor(contexts = []) {
    super('FunctionSet');
    this.functions = new Set(contexts); // Set of FunctionContext instances
  }

  add(funcCtx) {
    this.functions.add(funcCtx);
  }

  merge(other) {
    if (other instanceof FunctionSet) {
      for (const fn of other.functions) {
        this.functions.add(fn);
      }
    }
  }
}

class TableValue extends AbstractValue {
  constructor() {
    super('TableValue');
    this.fields = new Map(); // string/number key -> AbstractValue
  }

  set(key, val) {
    this.fields.set(String(key), val);
  }

  get(key) {
    return this.fields.get(String(key)) || new UnknownValue('missing_key');
  }
}

class BuiltinFunction extends AbstractValue {
  constructor(name) {
    super('BuiltinFunction');
    this.name = name;
  }
}

class ExternalValue extends AbstractValue {
  constructor(source) {
    super('ExternalValue');
    this.source = source;
  }
}

class PointsToAnalyzer {
  constructor(functionContexts = []) {
    this.contextsByConstructorId = new Map();
    this.contextsByEntryState = new Map();
    for (const ctx of functionContexts) {
      if (ctx.constructorId) this.contextsByConstructorId.set(ctx.constructorId, ctx);
      if (ctx.entryState !== null) this.contextsByEntryState.set(ctx.entryState, ctx);
    }

    this.environment = new Map(); // variable name -> AbstractValue
    this.tables = new Map(); // table identifier -> TableValue
    this.callGraphEdges = []; // { sourceContext, target, type: direct|indirect|callback }
    this.closureCaptures = []; // Phase 4 records
  }

  /**
   * Run conservative flow-insensitive points-to analysis on the AST.
   * @param {object} astChunk
   * @param {Array<object>} rawConstructors
   */
  analyze(astChunk, rawConstructors) {
    // 1. Initialize function sets from raw constructors
    const constructorToFuncSet = new Map();
    for (const c of rawConstructors) {
      const ctx = this.contextsByConstructorId.get(c.constructorId) ||
                  this.contextsByEntryState.get(c.entryState);
      if (ctx) {
        const fnSet = new FunctionSet([ctx]);
        constructorToFuncSet.set(c.node, fnSet);

        // Record capture information (Phase 4)
        this.closureCaptures.push({
          closureId: ctx.id,
          entryState: ctx.entryState,
          helper: ctx.helper,
          capturedUpvalues: c.capturedValues,
          sharedDispatcher: true
        });
      }
    }

    // 2. Track assignments: local f = closure, g = f, etc.
    const visit = (node, parent) => {
      if (!node || typeof node !== 'object') return;

      // Assignment: var = rhs
      if (node.type === ASTNodeType.AssignmentStatement || node.type === ASTNodeType.LocalStatement) {
        const vars = node.variables;
        const inits = node.init;

        for (let i = 0; i < Math.min(vars.length, inits.length); i++) {
          const v = vars[i];
          const init = inits[i];

          // RHS is a closure constructor call
          if (constructorToFuncSet.has(init)) {
            const fnSet = constructorToFuncSet.get(init);
            if (v.type === ASTNodeType.Identifier) {
              this.environment.set(v.name, fnSet);
            } else if (v.type === ASTNodeType.IndexExpression && v.base.type === ASTNodeType.Identifier) {
              let tbl = this.tables.get(v.base.name);
              if (!tbl) {
                tbl = new TableValue();
                this.tables.set(v.base.name, tbl);
              }
              const keyStr = v.index.value || 'dynamic';
              tbl.set(keyStr, fnSet);
              this.callGraphEdges.push({
                from: 'closure_store',
                to: Array.from(fnSet.functions).map(f => f.id),
                type: 'table_contained_function',
                table: v.base.name,
                key: keyStr
              });
            }
          }
          // RHS is an existing variable: g = f
          else if (init.type === ASTNodeType.Identifier && this.environment.has(init.name)) {
            const existingVal = this.environment.get(init.name);
            if (v.type === ASTNodeType.Identifier) {
              this.environment.set(v.name, existingVal);
            }
          }
        }
      }

      // Call expressions: f(...)
      if (node.type === ASTNodeType.CallExpression) {
        if (node.base.type === ASTNodeType.Identifier) {
          const fnName = node.base.name;
          if (this.environment.has(fnName)) {
            const val = this.environment.get(fnName);
            if (val instanceof FunctionSet) {
              for (const fn of val.functions) {
                fn.addCallSite({
                  type: 'direct_call',
                  variable: fnName,
                  isResolved: true
                });
                this.callGraphEdges.push({
                  from: 'caller',
                  to: fn.id,
                  type: 'direct_call'
                });
              }
            }
          }
        }
        // Passing closure as argument to a function: callback(f)
        for (const arg of node.arguments) {
          if (arg.type === ASTNodeType.Identifier && this.environment.has(arg.name)) {
            const val = this.environment.get(arg.name);
            if (val instanceof FunctionSet) {
              for (const fn of val.functions) {
                fn.addCallSite({
                  type: 'callback_registration',
                  callee: node.base.name || 'anonymous_call',
                  isResolved: true
                });
                this.callGraphEdges.push({
                  from: node.base.name || 'anonymous_call',
                  to: fn.id,
                  type: 'callback_registration'
                });
              }
            }
          }
        }
      }

      for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'type') continue;
        const c = node[k];
        if (Array.isArray(c)) c.forEach(item => visit(item, node));
        else if (c && typeof c === 'object') visit(c, node);
      }
    };

    visit(astChunk, null);

    return {
      environment: this.environment,
      tables: this.tables,
      callGraphEdges: this.callGraphEdges,
      closureCaptures: this.closureCaptures
    };
  }
}

module.exports = {
  AbstractValue,
  UnknownValue,
  PrimitiveValue,
  FunctionSet,
  TableValue,
  BuiltinFunction,
  ExternalValue,
  PointsToAnalyzer
};
