const fs = require('fs');
const path = require('path');
const { parse } = require('../packages/core/src/parser');
const { ASTNodeType } = require('../packages/core/src/ast/nodes');
const { STANDARD_BUILTINS } = require('../packages/core/src/analysis/alias');

function auditIdentifiers(resultFilePath) {
  const rawCode = fs.readFileSync(resultFilePath, 'utf8');

  // If IIFE is unparenthesized at top level, wrap it to allow AST construction
  let code = rawCode;
  if (!rawCode.trim().startsWith('return (function')) {
    code = rawCode.replace(/return\s+function\s*\(/m, 'return (function(');
    const lastParenIdx = code.lastIndexOf('end(...)');
    if (lastParenIdx !== -1) {
      code = code.slice(0, lastParenIdx) + 'end)(...)';
    }
  }

  let ast;
  try {
    ast = parse(code);
  } catch (err) {
    // Attempt second repair for inner IIFE if nested
    code = code.replace(/end\(getfenv/g, 'end)(getfenv');
    code = code.replace(/return\s+function\(A,\s*L/g, 'return (function(A, L');
    ast = parse(code);
  }

  class Scope {
    constructor(parent = null) {
      this.parent = parent;
      this.decls = new Set();
    }
    declare(name) {
      this.decls.add(name);
    }
    has(name) {
      if (this.decls.has(name)) return true;
      if (this.parent) return this.parent.has(name);
      return false;
    }
  }

  const undefinedRefs = [];
  let currentScope = new Scope();

  const isScopeNode = (node) => {
    return node.type === ASTNodeType.FunctionDeclaration ||
           node.type === ASTNodeType.LocalFunctionStatement ||
           node.type === ASTNodeType.FunctionExpression ||
           node.type === ASTNodeType.DoStatement ||
           node.type === ASTNodeType.WhileStatement ||
           node.type === ASTNodeType.RepeatStatement ||
           node.type === ASTNodeType.NumericForStatement ||
           node.type === ASTNodeType.GenericForStatement;
  };

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;

    const prevScope = currentScope;
    if (isScopeNode(node)) {
      currentScope = new Scope(prevScope);

      // Add parameters if function
      if (node.parameters || node.params) {
        const pList = node.parameters || node.params;
        for (const p of pList) {
          if (p.type === ASTNodeType.Identifier) {
            currentScope.declare(p.name);
          }
        }
      }

      // Add for-loop variables
      if (node.type === ASTNodeType.NumericForStatement && node.variable) {
        currentScope.declare(node.variable.name);
      } else if (node.type === ASTNodeType.GenericForStatement && node.variables) {
        for (const v of node.variables) {
          currentScope.declare(v.name);
        }
      }
    }

    // Declarations
    if (node.type === ASTNodeType.LocalStatement) {
      for (const v of node.variables) {
        if (v.type === ASTNodeType.Identifier) {
          currentScope.declare(v.name);
        }
      }
    } else if (node.type === ASTNodeType.LocalFunctionStatement && node.identifier) {
      currentScope.declare(node.identifier.name);
    }

    // Identifier references
    if (node.type === ASTNodeType.Identifier) {
      const name = node.name;
      if (!currentScope.has(name) && !STANDARD_BUILTINS.has(name)) {
        undefinedRefs.push({
          name,
          line: node.loc?.start?.line,
          col: node.loc?.start?.column
        });
      }
    }

    // Traverse children, skipping property names of MemberExpression and TableKeyString
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'type') continue;
      if (node.type === ASTNodeType.MemberExpression && k === 'property') continue;
      if (node.type === ASTNodeType.TableKeyString && k === 'key') continue;

      const c = node[k];
      if (Array.isArray(c)) c.forEach(walk);
      else if (c && typeof c === 'object') walk(c);
    }

    if (isScopeNode(node)) {
      currentScope = prevScope;
    }
  };

  walk(ast);

  // Group undefined references by name
  const summary = {};
  for (const ref of undefinedRefs) {
    summary[ref.name] = (summary[ref.name] || 0) + 1;
  }

  const report = {
    totalUndefinedReferences: undefinedRefs.length,
    uniqueUndefinedSymbols: Object.keys(summary).length,
    undefinedSymbols: summary,
    sampleReferences: undefinedRefs.slice(0, 20)
  };

  fs.writeFileSync(path.resolve(__dirname, 'undefined-identifiers.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('Wrote audit/undefined-identifiers.json');
  return report;
}

if (require.main === module) {
  const r = auditIdentifiers(path.resolve(__dirname, '../result.lua'));
  console.log(JSON.stringify(r, null, 2));
}

module.exports = { auditIdentifiers };
