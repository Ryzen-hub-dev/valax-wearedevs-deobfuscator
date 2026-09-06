const { ASTNodeType } = require('../ast/nodes');
const { Scope } = require('./scope');
const { ByteString } = require('../../../shared/src');

const LatticeType = {
  UNKNOWN: 'Unknown',
  KNOWN_NUMBER: 'KnownNumber',
  KNOWN_STRING: 'KnownString',
  KNOWN_BOOLEAN: 'KnownBoolean',
  KNOWN_NIL: 'KnownNil',
  KNOWN_TABLE: 'KnownTable',
  SYMBOLIC: 'Symbolic'
};

class DataFlowAnalyzer {
  constructor() {
    this.rootScope = new Scope();
    this.currentScope = this.rootScope;
    this.knownConstants = new Map(); // name -> Lattice value
    this.stats = {
      constantsTracked: 0,
      unusedLocalsFound: 0
    };
  }

  analyze(astChunk) {
    this.buildScopes(astChunk);
    this.findUnusedLocals(this.rootScope);
    return {
      rootScope: this.rootScope,
      knownConstants: this.knownConstants,
      stats: this.stats
    };
  }

  buildScopes(node) {
    if (!node || typeof node !== 'object') return;

    // Scope introducing nodes: Chunk, FunctionDeclaration, LocalFunctionStatement, FunctionExpression, DoStatement, WhileStatement, For
    const isNewScope = node.type === ASTNodeType.FunctionDeclaration ||
                       node.type === ASTNodeType.LocalFunctionStatement ||
                       node.type === ASTNodeType.FunctionExpression ||
                       node.type === ASTNodeType.DoStatement ||
                       node.type === ASTNodeType.WhileStatement ||
                       node.type === ASTNodeType.NumericForStatement ||
                       node.type === ASTNodeType.GenericForStatement;

    const prevScope = this.currentScope;
    if (isNewScope) {
      this.currentScope = new Scope(prevScope);
    }

    // Declarations
    if (node.type === ASTNodeType.LocalStatement) {
      for (let i = 0; i < node.variables.length; i++) {
        const v = node.variables[i];
        this.currentScope.declare(v.name, node);
        const init = node.init[i];
        if (init) {
          const lat = this.toLatticeValue(init);
          if (lat.type !== LatticeType.UNKNOWN && lat.type !== LatticeType.SYMBOLIC) {
            this.knownConstants.set(v.name, lat);
            this.stats.constantsTracked++;
          }
        }
      }
    } else if (node.type === ASTNodeType.LocalFunctionStatement) {
      this.currentScope.declare(node.identifier.name, node);
    }

    // References
    if (node.type === ASTNodeType.Identifier) {
      this.currentScope.reference(node.name, node);
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'type') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(c => this.buildScopes(c));
      } else if (child && typeof child === 'object') {
        this.buildScopes(child);
      }
    }

    if (isNewScope) {
      this.currentScope = prevScope;
    }
  }

  toLatticeValue(node) {
    if (!node) return { type: LatticeType.UNKNOWN };
    switch (node.type) {
      case ASTNodeType.NumericLiteral:
        return { type: LatticeType.KNOWN_NUMBER, value: node.value };
      case ASTNodeType.StringLiteral:
        return { type: LatticeType.KNOWN_STRING, value: node.value };
      case ASTNodeType.BooleanLiteral:
        return { type: LatticeType.KNOWN_BOOLEAN, value: node.value };
      case ASTNodeType.NilLiteral:
        return { type: LatticeType.KNOWN_NIL, value: null };
      case ASTNodeType.TableConstructor:
        return { type: LatticeType.KNOWN_TABLE, node };
      default:
        return { type: LatticeType.SYMBOLIC, node };
    }
  }

  findUnusedLocals(scope) {
    for (const [name, info] of scope.variables.entries()) {
      if (info.references.length === 0 && !name.startsWith('_')) {
        this.stats.unusedLocalsFound++;
      }
    }
    for (const child of scope.children) {
      this.findUnusedLocals(child);
    }
  }
}

module.exports = {
  DataFlowAnalyzer,
  LatticeType
};
