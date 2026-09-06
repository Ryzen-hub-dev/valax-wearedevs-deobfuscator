/**
 * Bounded Abstract & Symbolic State Evaluator for Dispatcher Transitions
 */

class SymbolicValue {
  constructor(kind) {
    this.kind = kind;
  }
}

class KnownNumber extends SymbolicValue {
  constructor(value) {
    super('KnownNumber');
    this.value = Number(value);
  }
}

class KnownBoolean extends SymbolicValue {
  constructor(value) {
    super('KnownBoolean');
    this.value = Boolean(value);
  }
}

class KnownString extends SymbolicValue {
  constructor(value) {
    super('KnownString');
    this.value = String(value);
  }
}

class KnownNil extends SymbolicValue {
  constructor() {
    super('KnownNil');
    this.value = null;
  }
}

class FiniteNumberSet extends SymbolicValue {
  constructor(values = []) {
    super('FiniteNumberSet');
    this.values = new Set(values.map(Number));
  }
}

class KnownTable extends SymbolicValue {
  constructor() {
    super('KnownTable');
    this.entries = new Map();
  }

  set(key, val) {
    this.entries.set(String(key), val);
  }

  get(key) {
    return this.entries.get(String(key)) || new KnownNil();
  }
}

class Top extends SymbolicValue {
  constructor(reason = 'unknown') {
    super('Top');
    this.reason = reason;
  }
}

class BoundedSymbolicEvaluator {
  constructor(options = {}) {
    this.maxSetSize = options.maxSetSize || 16;
    this.maxContexts = options.maxContexts || 64;
  }

  /**
   * Evaluates an AST expression in the context of known variables.
   * Recognizes Q = A[W(...)] as terminal nil transition.
   */
  evaluate(expr, env = new Map()) {
    if (!expr || typeof expr !== 'object') return new Top('invalid_node');

    if (expr.type === 'NumericLiteral') {
      return new KnownNumber(expr.value);
    }
    if (expr.type === 'BooleanLiteral') {
      return new KnownBoolean(expr.value);
    }
    if (expr.type === 'StringLiteral') {
      return new KnownString(expr.value);
    }
    if (expr.type === 'NilLiteral') {
      return new KnownNil();
    }

    if (expr.type === 'Identifier') {
      if (env.has(expr.name)) {
        return env.get(expr.name);
      }
      return new Top(`unbound_${expr.name}`);
    }

    // Recognize terminal exit pattern: A[W(...)] or A["unassigned_var"]
    if (expr.type === 'IndexExpression' &&
        expr.base.type === 'Identifier' &&
        (expr.base.name === 'A' || expr.base.name === '_ENV')) {
      // In Lua 5.1/Luau, unassigned global reads return nil
      return new KnownNil();
    }

    // Ternary: cond and s1 or s2
    if (expr.type === 'LogicalExpression' && expr.operator === 'or' &&
        expr.left.type === 'LogicalExpression' && expr.left.operator === 'and') {
      const cond = this.evaluate(expr.left.left, env);
      const trueVal = this.evaluate(expr.left.right, env);
      const falseVal = this.evaluate(expr.right, env);

      if (cond instanceof KnownBoolean) {
        return cond.value ? trueVal : falseVal;
      }

      // Both branches possible: merge into finite set if both are numbers
      if (trueVal instanceof KnownNumber && falseVal instanceof KnownNumber) {
        return new FiniteNumberSet([trueVal.value, falseVal.value]);
      }
    }

    return new Top('unresolved_expression');
  }
}

module.exports = {
  SymbolicValue,
  KnownNumber,
  KnownBoolean,
  KnownString,
  KnownNil,
  FiniteNumberSet,
  KnownTable,
  Top,
  BoundedSymbolicEvaluator
};
