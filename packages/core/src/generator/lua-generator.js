const { ASTNodeType } = require('../ast/nodes');

class LuaGenerator {
  constructor(options = {}) {
    this.indentStr = options.indent || '  ';
    this.indentLevel = 0;
    this.out = '';
  }

  indent() {
    return this.indentStr.repeat(this.indentLevel);
  }

  write(str) {
    this.out += str;
  }

  writeln(str = '') {
    if (str) {
      this.out += this.indent() + str + '\n';
    } else {
      this.out += '\n';
    }
  }

  generate(node) {
    this.generateNode(node);
    return this.out.trimEnd() + '\n';
  }

  generateNode(node) {
    if (!node) return;

    switch (node.type) {
      case ASTNodeType.Chunk:
        this.generateBlock(node.body);
        break;

      case ASTNodeType.LocalStatement:
        this.generateLocalStatement(node);
        break;

      case ASTNodeType.AssignmentStatement:
        this.generateAssignmentStatement(node);
        break;

      case ASTNodeType.LocalFunctionStatement:
        this.generateLocalFunctionStatement(node);
        break;

      case ASTNodeType.FunctionDeclaration:
        this.generateFunctionDeclaration(node);
        break;

      case ASTNodeType.CallStatement:
        this.writeln(this.exprToString(node.expression));
        break;

      case ASTNodeType.IfStatement:
        this.generateIfStatement(node);
        break;

      case ASTNodeType.WhileStatement:
        this.generateWhileStatement(node);
        break;

      case ASTNodeType.RepeatStatement:
        this.generateRepeatStatement(node);
        break;

      case ASTNodeType.NumericForStatement:
        this.generateNumericForStatement(node);
        break;

      case ASTNodeType.GenericForStatement:
        this.generateGenericForStatement(node);
        break;

      case ASTNodeType.DoStatement:
        this.generateDoStatement(node);
        break;

      case ASTNodeType.ReturnStatement:
        if (node.arguments.length === 0) {
          this.writeln('return');
        } else {
          this.writeln('return ' + node.arguments.map(a => this.exprToString(a)).join(', '));
        }
        break;

      case ASTNodeType.BreakStatement:
        this.writeln('break');
        break;

      case ASTNodeType.ContinueStatement:
        this.writeln('continue');
        break;

      case ASTNodeType.EmptyStatement:
        // Omit unnecessary semicolons
        break;

      default:
        this.writeln(`-- [UNKNOWN STATEMENT: ${node.type}]`);
    }
  }

  generateBlock(statements) {
    for (const stmt of statements) {
      this.generateNode(stmt);
    }
  }

  generateLocalStatement(node) {
    const vars = node.variables.map(v => this.exprToString(v)).join(', ');
    if (node.init.length > 0) {
      const inits = node.init.map(i => this.exprToString(i)).join(', ');
      this.writeln(`local ${vars} = ${inits}`);
    } else {
      this.writeln(`local ${vars}`);
    }
  }

  generateAssignmentStatement(node) {
    const vars = node.variables.map(v => this.exprToString(v)).join(', ');
    const inits = node.init.map(i => this.exprToString(i)).join(', ');
    this.writeln(`${vars} = ${inits}`);
  }

  generateLocalFunctionStatement(node) {
    const params = node.params.map(p => p.name);
    if (node.isVararg) params.push('...');
    this.writeln(`local function ${node.identifier.name}(${params.join(', ')})`);
    this.indentLevel++;
    this.generateBlock(node.body);
    this.indentLevel--;
    this.writeln('end');
  }

  generateFunctionDeclaration(node) {
    const nameStr = this.exprToString(node.name);
    const params = node.params.map(p => p.name);
    if (node.isVararg) params.push('...');
    this.writeln(`function ${nameStr}(${params.join(', ')})`);
    this.indentLevel++;
    this.generateBlock(node.body);
    this.indentLevel--;
    this.writeln('end');
  }

  generateIfStatement(node) {
    for (let i = 0; i < node.clauses.length; i++) {
      const clause = node.clauses[i];
      const prefix = i === 0 ? 'if ' : 'elseif ';
      this.writeln(`${prefix}${this.exprToString(clause.condition)} then`);
      this.indentLevel++;
      this.generateBlock(clause.body);
      this.indentLevel--;
    }
    if (node.elseBody && node.elseBody.length > 0) {
      this.writeln('else');
      this.indentLevel++;
      this.generateBlock(node.elseBody);
      this.indentLevel--;
    }
    this.writeln('end');
  }

  generateWhileStatement(node) {
    this.writeln(`while ${this.exprToString(node.condition)} do`);
    this.indentLevel++;
    this.generateBlock(node.body);
    this.indentLevel--;
    this.writeln('end');
  }

  generateRepeatStatement(node) {
    this.writeln('repeat');
    this.indentLevel++;
    this.generateBlock(node.body);
    this.indentLevel--;
    this.writeln(`until ${this.exprToString(node.condition)}`);
  }

  generateNumericForStatement(node) {
    let header = `for ${node.variable.name} = ${this.exprToString(node.start)}, ${this.exprToString(node.end)}`;
    if (node.step) {
      header += `, ${this.exprToString(node.step)}`;
    }
    header += ' do';
    this.writeln(header);
    this.indentLevel++;
    this.generateBlock(node.body);
    this.indentLevel--;
    this.writeln('end');
  }

  generateGenericForStatement(node) {
    const vars = node.variables.map(v => v.name).join(', ');
    const iters = node.iterators.map(i => this.exprToString(i)).join(', ');
    this.writeln(`for ${vars} in ${iters} do`);
    this.indentLevel++;
    this.generateBlock(node.body);
    this.indentLevel--;
    this.writeln('end');
  }

  generateDoStatement(node) {
    this.writeln('do');
    this.indentLevel++;
    this.generateBlock(node.body);
    this.indentLevel--;
    this.writeln('end');
  }

  // Precedence for expressions
  getPrecedence(node) {
    switch (node.type) {
      case ASTNodeType.LogicalExpression:
        return node.operator === 'or' ? 1 : 2;
      case ASTNodeType.BinaryExpression:
        if (['<', '>', '<=', '>=', '~=', '=='].includes(node.operator)) return 3;
        if (node.operator === '..') return 4;
        if (['+', '-'].includes(node.operator)) return 5;
        if (['*', '/', '%'].includes(node.operator)) return 6;
        if (node.operator === '^') return 8;
        return 0;
      case ASTNodeType.UnaryExpression:
        return 7;
      default:
        return 99; // Primary expressions
    }
  }

  exprToString(node, parentPrecedence = 0) {
    if (!node) return '';

    const currentPrec = this.getPrecedence(node);
    let result = '';

    switch (node.type) {
      case ASTNodeType.Identifier:
        result = node.name;
        break;

      case ASTNodeType.NumericLiteral:
        result = typeof node.raw === 'string' && node.raw.length > 0 ? node.raw : String(node.value);
        break;

      case ASTNodeType.StringLiteral:
        if (node.value && typeof node.value.toLuaLiteral === 'function') {
          result = node.value.toLuaLiteral();
        } else if (typeof node.value === 'string') {
          result = JSON.stringify(node.value);
        } else {
          result = node.raw || '""';
        }
        break;

      case ASTNodeType.BooleanLiteral:
        result = node.value ? 'true' : 'false';
        break;

      case ASTNodeType.NilLiteral:
        result = 'nil';
        break;

      case ASTNodeType.VarargLiteral:
        result = node.inParens ? '(...)' : '...';
        break;

      case ASTNodeType.UnaryExpression: {
        const argStr = this.exprToString(node.argument, currentPrec);
        const sep = node.operator === 'not' ? ' ' : '';
        result = `${node.operator}${sep}${argStr}`;
        break;
      }

      case ASTNodeType.BinaryExpression:
      case ASTNodeType.LogicalExpression: {
        const isRightAssoc = node.operator === '..' || node.operator === '^';
        const leftPrec = isRightAssoc ? currentPrec + 0.1 : currentPrec;
        const rightPrec = isRightAssoc ? currentPrec : currentPrec + 0.1;
        const leftStr = this.exprToString(node.left, leftPrec);
        const rightStr = this.exprToString(node.right, rightPrec);
        result = `${leftStr} ${node.operator} ${rightStr}`;
        break;
      }

      case ASTNodeType.CallExpression: {
        let baseStr = this.exprToString(node.base, 99);
        if (node.base.type === ASTNodeType.FunctionExpression) {
          baseStr = `(${baseStr})`;
        }
        const argsStr = node.arguments.map(a => this.exprToString(a, 0)).join(', ');
        result = `${baseStr}(${argsStr})`;
        break;
      }

      case ASTNodeType.MethodCallExpression: {
        let baseStr = this.exprToString(node.base, 99);
        if (node.base.type === ASTNodeType.FunctionExpression) {
          baseStr = `(${baseStr})`;
        }
        const argsStr = node.arguments.map(a => this.exprToString(a, 0)).join(', ');
        result = `${baseStr}:${node.method.name}(${argsStr})`;
        break;
      }

      case ASTNodeType.MemberExpression: {
        let baseStr = this.exprToString(node.base, 99);
        if (node.base.type === ASTNodeType.FunctionExpression) {
          baseStr = `(${baseStr})`;
        }
        result = `${baseStr}.${node.property.name}`;
        break;
      }

      case ASTNodeType.IndexExpression: {
        let baseStr = this.exprToString(node.base, 99);
        if (node.base.type === ASTNodeType.FunctionExpression) {
          baseStr = `(${baseStr})`;
        }
        const indexStr = this.exprToString(node.index, 0);
        result = `${baseStr}[${indexStr}]`;
        break;
      }

      case ASTNodeType.FunctionExpression: {
        const params = node.params.map(p => p.name);
        if (node.isVararg) params.push('...');
        const innerGen = new LuaGenerator({ indent: this.indentStr });
        innerGen.indentLevel = this.indentLevel + 1;
        innerGen.generateBlock(node.body);
        result = `function(${params.join(', ')})\n${innerGen.out}${this.indent()}end`;
        break;
      }

      case ASTNodeType.TableConstructor: {
        if (node.fields.length === 0) {
          result = '{}';
        } else if (node.fields.length <= 4 && node.fields.every(f => f.type === ASTNodeType.TableValue)) {
          // Compact array formatting
          const items = node.fields.map(f => this.exprToString(f.value, 0));
          result = `{ ${items.join(', ')} }`;
        } else {
          // Multiline formatting
          const innerIndent = this.indentStr.repeat(this.indentLevel + 1);
          const fieldsStr = node.fields.map(f => {
            if (f.type === ASTNodeType.TableKey) {
              return `${innerIndent}[${this.exprToString(f.key, 0)}] = ${this.exprToString(f.value, 0)}`;
            } else if (f.type === ASTNodeType.TableKeyString) {
              return `${innerIndent}${f.key.name} = ${this.exprToString(f.value, 0)}`;
            } else {
              return `${innerIndent}${this.exprToString(f.value, 0)}`;
            }
          }).join(',\n');
          result = `{\n${fieldsStr}\n${this.indent()}}`;
        }
        break;
      }

      default:
        result = `/* UNKNOWN EXPR: ${node.type} */`;
    }

    if (currentPrec < parentPrecedence) {
      return `(${result})`;
    }
    return result;
  }
}

function generate(astNode, options = {}) {
  const gen = new LuaGenerator(options);
  return gen.generate(astNode);
}

module.exports = {
  LuaGenerator,
  generate
};
