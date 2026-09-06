const { ASTNodeType, numericLiteral, booleanLiteral, stringLiteral } = require('../ast/nodes');
const { ByteString } = require('../../../shared/src');

class ConstantEvaluator {
  constructor() {
    this.stats = {
      expressionsInspected: 0,
      expressionsSimplified: 0,
      constantsPropagated: 0,
      unsafeExpressionsSkipped: 0
    };
  }

  /**
   * Reset evaluation statistics.
   */
  resetStats() {
    this.stats = {
      expressionsInspected: 0,
      expressionsSimplified: 0,
      constantsPropagated: 0,
      unsafeExpressionsSkipped: 0
    };
  }

  /**
   * Evaluate and fold constant expressions in an AST node recursively.
   * @param {object} node
   * @returns {object}
   */
  fold(node) {
    if (!node || typeof node !== 'object') return node;

    // Fold children first (post-order traversal)
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'type') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        node[key] = child.map(c => this.fold(c));
      } else if (child && typeof child === 'object') {
        node[key] = this.fold(child);
      }
    }

    // Try folding this expression
    if (this.isFoldable(node)) {
      this.stats.expressionsInspected++;
      const folded = this.tryEvaluate(node);
      if (folded !== null) {
        this.stats.expressionsSimplified++;
        return folded;
      } else {
        this.stats.unsafeExpressionsSkipped++;
      }
    }

    return node;
  }

  isFoldable(node) {
    return node.type === ASTNodeType.UnaryExpression ||
           node.type === ASTNodeType.BinaryExpression ||
           node.type === ASTNodeType.LogicalExpression;
  }

  tryEvaluate(node) {
    switch (node.type) {
      case ASTNodeType.UnaryExpression:
        return this.evalUnary(node);
      case ASTNodeType.BinaryExpression:
        return this.evalBinary(node);
      case ASTNodeType.LogicalExpression:
        return this.evalLogical(node);
      default:
        return null;
    }
  }

  evalUnary(node) {
    const arg = node.argument;

    // Unary minus
    if (node.operator === '-') {
      if (arg.type === ASTNodeType.NumericLiteral) {
        return numericLiteral(-arg.value, String(-arg.value));
      }
    }

    // Unary not
    if (node.operator === 'not') {
      if (arg.type === ASTNodeType.BooleanLiteral) {
        return booleanLiteral(!arg.value);
      }
      if (arg.type === ASTNodeType.NilLiteral) {
        return booleanLiteral(true);
      }
      // In Lua, numbers, strings, tables are truthy
      if (arg.type === ASTNodeType.NumericLiteral ||
          arg.type === ASTNodeType.StringLiteral ||
          arg.type === ASTNodeType.TableConstructor) {
        return booleanLiteral(false);
      }
    }

    // Unary length #
    if (node.operator === '#') {
      if (arg.type === ASTNodeType.StringLiteral) {
        const len = arg.value instanceof ByteString ? arg.value.length : Buffer.byteLength(String(arg.value));
        return numericLiteral(len, String(len));
      }
    }

    return null;
  }

  evalBinary(node) {
    const left = node.left;
    const right = node.right;

    // Both are numbers
    if (left.type === ASTNodeType.NumericLiteral && right.type === ASTNodeType.NumericLiteral) {
      const l = left.value;
      const r = right.value;

      switch (node.operator) {
        case '+': {
          const res = l + r;
          if (Number.isFinite(res)) return numericLiteral(res, String(res));
          break;
        }
        case '-': {
          const res = l - r;
          if (Number.isFinite(res)) return numericLiteral(res, String(res));
          break;
        }
        case '*': {
          const res = l * r;
          if (Number.isFinite(res)) return numericLiteral(res, String(res));
          break;
        }
        case '/': {
          if (r !== 0) {
            const res = l / r;
            if (Number.isFinite(res)) return numericLiteral(res, String(res));
          }
          break;
        }
        case '%': {
          if (r !== 0) {
            // Lua modulo: floor division sign of divisor
            const res = l - Math.floor(l / r) * r;
            if (Number.isFinite(res)) return numericLiteral(res, String(res));
          }
          break;
        }
        case '^': {
          // Safe power
          if (Math.abs(r) <= 64 && Math.abs(l) <= 1e9) {
            const res = Math.pow(l, r);
            if (Number.isFinite(res)) return numericLiteral(res, String(res));
          }
          break;
        }
        case '<': return booleanLiteral(l < r);
        case '<=': return booleanLiteral(l <= r);
        case '>': return booleanLiteral(l > r);
        case '>=': return booleanLiteral(l >= r);
        case '==': return booleanLiteral(l === r);
        case '~=': return booleanLiteral(l !== r);
      }
    }

    // String concatenation
    if (node.operator === '..' &&
        left.type === ASTNodeType.StringLiteral &&
        right.type === ASTNodeType.StringLiteral) {
      const lBs = left.value instanceof ByteString ? left.value : new ByteString(String(left.value));
      const rBs = right.value instanceof ByteString ? right.value : new ByteString(String(right.value));
      return stringLiteral(lBs.concat(rBs));
    }

    // Equality between identical constant types
    if (node.operator === '==' || node.operator === '~=') {
      const isEq = node.operator === '==';

      // Both booleans
      if (left.type === ASTNodeType.BooleanLiteral && right.type === ASTNodeType.BooleanLiteral) {
        return booleanLiteral(isEq ? left.value === right.value : left.value !== right.value);
      }

      // Both nil
      if (left.type === ASTNodeType.NilLiteral && right.type === ASTNodeType.NilLiteral) {
        return booleanLiteral(isEq);
      }

      // Nil compared to non-nil literal
      if ((left.type === ASTNodeType.NilLiteral && (right.type === ASTNodeType.NumericLiteral || right.type === ASTNodeType.StringLiteral || right.type === ASTNodeType.BooleanLiteral)) ||
          (right.type === ASTNodeType.NilLiteral && (left.type === ASTNodeType.NumericLiteral || left.type === ASTNodeType.StringLiteral || left.type === ASTNodeType.BooleanLiteral))) {
        return booleanLiteral(!isEq);
      }

      // Both strings
      if (left.type === ASTNodeType.StringLiteral && right.type === ASTNodeType.StringLiteral) {
        const lBs = left.value instanceof ByteString ? left.value : new ByteString(String(left.value));
        const rBs = right.value instanceof ByteString ? right.value : new ByteString(String(right.value));
        const equal = lBs.equals(rBs);
        return booleanLiteral(isEq ? equal : !equal);
      }

      // Different types (e.g. number == string) are always false in Lua
      if ((left.type === ASTNodeType.NumericLiteral && right.type === ASTNodeType.StringLiteral) ||
          (left.type === ASTNodeType.StringLiteral && right.type === ASTNodeType.NumericLiteral) ||
          (left.type === ASTNodeType.BooleanLiteral && right.type === ASTNodeType.NumericLiteral) ||
          (left.type === ASTNodeType.NumericLiteral && right.type === ASTNodeType.BooleanLiteral)) {
        return booleanLiteral(!isEq);
      }
    }

    return null;
  }

  evalLogical(node) {
    const left = node.left;
    const right = node.right;

    // Check if left is statically truthy or falsy
    const leftTruthy = this.isStaticallyTruthy(left);
    if (leftTruthy !== null) {
      if (node.operator === 'and') {
        // truthy and right => right
        // falsy and right => left
        return leftTruthy ? right : left;
      } else if (node.operator === 'or') {
        // truthy or right => left
        // falsy or right => right
        return leftTruthy ? left : right;
      }
    }

    return null;
  }

  /**
   * Returns true if definitely truthy, false if definitely falsy, null if unknown.
   * In Lua: only `false` and `nil` are falsy. 0 and "" are truthy!
   */
  isStaticallyTruthy(node) {
    if (node.type === ASTNodeType.BooleanLiteral) {
      return node.value;
    }
    if (node.type === ASTNodeType.NilLiteral) {
      return false;
    }
    if (node.type === ASTNodeType.NumericLiteral ||
        node.type === ASTNodeType.StringLiteral ||
        node.type === ASTNodeType.TableConstructor ||
        node.type === ASTNodeType.FunctionExpression) {
      return true;
    }
    return null;
  }
}

function foldConstants(astNode) {
  const evaluator = new ConstantEvaluator();
  const folded = evaluator.fold(astNode);
  return { ast: folded, stats: evaluator.stats };
}

module.exports = {
  ConstantEvaluator,
  foldConstants
};
