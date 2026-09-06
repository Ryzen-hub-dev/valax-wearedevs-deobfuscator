const fs = require('fs');
const path = require('path');
const { parse } = require('../packages/core/src/parser');
const { ASTNodeType } = require('../packages/core/src/ast/nodes');

function auditAliases(fixturePath) {
  const source = fs.readFileSync(fixturePath, 'utf8');
  const ast = parse(source);

  const aliases = [];

  const visit = (node) => {
    if (!node || typeof node !== 'object') return;

    // Direct local assignment: local x = lib.func or local x = builtin
    if (node.type === ASTNodeType.LocalStatement) {
      for (let i = 0; i < node.variables.length; i++) {
        const v = node.variables[i];
        const init = node.init[i];
        if (!init) continue;

        if (init.type === ASTNodeType.MemberExpression &&
            init.base.type === ASTNodeType.Identifier &&
            init.property.type === ASTNodeType.Identifier) {
          aliases.push({
            sourceSymbol: v.name,
            resolvedBuiltin: `${init.base.name}.${init.property.name}`,
            evidence: `Direct local statement assignment: local ${v.name} = ${init.base.name}.${init.property.name}`,
            confidence: 'PROVEN'
          });
        } else if (init.type === ASTNodeType.Identifier && ['type', 'select', 'pcall', 'xpcall', 'setmetatable', 'getmetatable', 'rawget', 'rawset', 'newproxy', 'print'].includes(init.name)) {
          aliases.push({
            sourceSymbol: v.name,
            resolvedBuiltin: init.name,
            evidence: `Direct local statement assignment: local ${v.name} = ${init.name}`,
            confidence: 'PROVEN'
          });
        }
      }
    }

    // Function parameter binding: (function(A, L, K, u, y, s, d, ...))(getfenv and getfenv() or _ENV, unpack or table[...], newproxy, setmetatable, getmetatable, select, ...)
    if (node.type === ASTNodeType.CallExpression &&
        node.base.type === ASTNodeType.FunctionExpression &&
        node.arguments.length >= 6) {
      const params = node.base.params || [];
      const args = node.arguments || [];
      for (let i = 0; i < Math.min(params.length, args.length); i++) {
        const p = params[i];
        const a = args[i];
        if (p && p.type === ASTNodeType.Identifier) {
          if (a && a.type === ASTNodeType.Identifier) {
            aliases.push({
              sourceSymbol: p.name,
              resolvedBuiltin: a.name,
              evidence: `IIFE argument passing at parameter index ${i}: param ${p.name} receives arg ${a.name}`,
              confidence: 'PROVEN'
            });
          } else if (a && a.type === ASTNodeType.LogicalExpression) {
            aliases.push({
              sourceSymbol: p.name,
              resolvedBuiltin: '_ENV',
              evidence: `IIFE argument passing at parameter index ${i}: param ${p.name} receives environment binding`,
              confidence: 'PROVEN'
            });
          }
        }
      }
    }

    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'type') continue;
      const c = node[k];
      if (Array.isArray(c)) c.forEach(visit);
      else if (c && typeof c === 'object') visit(c);
    }
  };

  visit(ast);

  const report = {
    totalAliasesFound: aliases.length,
    aliases
  };

  fs.writeFileSync(path.resolve(__dirname, 'alias-audit.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('Wrote audit/alias-audit.json');
  return report;
}

if (require.main === module) {
  const rep = auditAliases(path.resolve(__dirname, '../ByIdiotSandWich.txt'));
  console.log(JSON.stringify(rep, null, 2));
}

module.exports = { auditAliases };
