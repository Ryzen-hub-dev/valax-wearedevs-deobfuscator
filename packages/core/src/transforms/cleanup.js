const { ASTNodeType, emptyStatement } = require('../ast/nodes');
const { transform } = require('../ast/visitor');
const { ConstantEvaluator } = require('../evaluator/constant-evaluator');
const { DataFlowAnalyzer, LatticeType } = require('../analysis');

class CleanupPasses {
  constructor(maxPasses = 10) {
    this.maxPasses = maxPasses;
    this.evaluator = new ConstantEvaluator();
    this.stats = {
      passesRun: 0,
      deadBranchesEliminated: 0,
      emptyStatementsRemoved: 0,
      unusedLocalsRemoved: 0
    };
  }

  run(astChunk) {
    let currentAst = astChunk;
    let changed = true;
    let pass = 0;

    while (changed && pass < this.maxPasses) {
      pass++;
      changed = false;

      // 0. Propagate local constants
      const propRes = this.propagateLocalConstants(currentAst);
      if (propRes.changed) {
        currentAst = propRes.ast;
        changed = true;
      }

      // 1. Fold constants
      const beforeFold = this.evaluator.stats.expressionsSimplified;
      currentAst = this.evaluator.fold(currentAst);
      if (this.evaluator.stats.expressionsSimplified > beforeFold) {
        changed = true;
      }

      // 2. Eliminate dead branches
      const branchRes = this.eliminateDeadBranches(currentAst);
      if (branchRes.changed) {
        currentAst = branchRes.ast;
        changed = true;
      }

      // 3. Remove empty statements and do-blocks
      const cleanRes = this.eliminateEmptyBlocks(currentAst);
      if (cleanRes.changed) {
        currentAst = cleanRes.ast;
        changed = true;
      }
    }

    this.stats.passesRun = pass;
    return { ast: currentAst, stats: this.stats };
  }

  propagateLocalConstants(astChunk) {
    let changed = false;

    const findAssignments = (body) => {
      const constants = new Map();
      const reassigned = new Set();

      for (const stmt of body) {
        if (stmt.type === ASTNodeType.LocalStatement) {
          for (let i = 0; i < (stmt.variables || []).length; i++) {
            const v = stmt.variables[i];
            const init = stmt.init ? stmt.init[i] : null;
            if (v && init && (
              init.type === ASTNodeType.BooleanLiteral ||
              init.type === ASTNodeType.NumericLiteral ||
              init.type === ASTNodeType.StringLiteral ||
              init.type === ASTNodeType.NilLiteral
            )) {
              constants.set(v.name, init);
            }
          }
        } else if (stmt.type === ASTNodeType.AssignmentStatement) {
          for (const v of stmt.variables || []) {
            if (v.type === ASTNodeType.Identifier) {
              reassigned.add(v.name);
            }
          }
        }
      }

      for (const r of reassigned) {
        constants.delete(r);
      }

      return constants;
    };

    const walkBlocks = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.body && Array.isArray(node.body)) {
        const consts = findAssignments(node.body);
        if (consts.size > 0) {
          for (const stmt of node.body) {
            transform(stmt, (n, parent) => {
              if (n.type === ASTNodeType.Identifier && consts.has(n.name)) {
                if (parent && parent.type === ASTNodeType.LocalStatement) return n;
                if (parent && parent.type === ASTNodeType.AssignmentStatement && parent.variables && parent.variables.includes(n)) return n;
                if (parent && parent.type === ASTNodeType.MemberExpression && parent.property === n) return n;
                changed = true;
                return { ...consts.get(n.name) };
              }
            });
          }
        }
      }
      for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'type') continue;
        const c = node[k];
        if (Array.isArray(c)) c.forEach(walkBlocks);
        else if (c && typeof c === 'object') walkBlocks(c);
      }
    };

    walkBlocks(astChunk);
    return { changed, ast: astChunk };
  }

  eliminateDeadBranches(astChunk) {
    let changed = false;

    const transformed = transform(astChunk, (node) => {
      if (node.type === ASTNodeType.IfStatement) {
        // Check if first condition is statically true
        const firstCond = node.clauses[0].condition;
        if (firstCond.type === ASTNodeType.BooleanLiteral && firstCond.value === true) {
          changed = true;
          this.stats.deadBranchesEliminated++;
          // Replace with its body
          return node.clauses[0].body;
        }

        // Check if condition is statically false
        if (firstCond.type === ASTNodeType.BooleanLiteral && firstCond.value === false) {
          changed = true;
          this.stats.deadBranchesEliminated++;
          // If there's elseif or else, use them
          if (node.clauses.length > 1) {
            node.clauses.shift();
            return node;
          } else if (node.elseBody && node.elseBody.length > 0) {
            return node.elseBody;
          } else {
            return emptyStatement();
          }
        }
      }

      return undefined;
    });

    return { ast: transformed, changed };
  }

  eliminateEmptyBlocks(astChunk) {
    let changed = false;

    const cleanBlock = (stmts) => {
      const filtered = [];
      for (const s of stmts) {
        if (s.type === ASTNodeType.EmptyStatement) {
          changed = true;
          this.stats.emptyStatementsRemoved++;
          continue;
        }
        if (s.type === ASTNodeType.DoStatement && s.body.length === 0) {
          changed = true;
          this.stats.emptyStatementsRemoved++;
          continue;
        }
        filtered.push(s);
      }
      return filtered;
    };

    const transformed = transform(astChunk, (node) => {
      if (node.type === ASTNodeType.Chunk) {
        node.body = cleanBlock(node.body);
      } else if (node.body && Array.isArray(node.body)) {
        node.body = cleanBlock(node.body);
      }
      return undefined;
    });

    return { ast: transformed, changed };
  }
}

module.exports = { CleanupPasses };
