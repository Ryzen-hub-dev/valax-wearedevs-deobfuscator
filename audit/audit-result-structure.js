const fs = require('fs');
const path = require('path');
const { parse } = require('../packages/core/src/parser');
const { ASTNodeType } = require('../packages/core/src/ast/nodes');
const { traverse } = require('../packages/core/src/ast/visitor');

function auditResultStructure() {
  const resultPath = path.resolve(__dirname, '../result.lua');
  const code = fs.readFileSync(resultPath, 'utf8');

  const stats = {
    fileBytes: Buffer.byteLength(code, 'utf8'),
    totalLines: code.split('\n').length,
    parseDirectly: false,
    parseError: null,
    nodeCounts: {},
    closureConstructorsFound: [],
    dispatcherRemaining: false,
    prunedPayloadDetected: false,
    findings: []
  };

  // Try direct parsing
  let ast = null;
  try {
    ast = parse(code);
    stats.parseDirectly = true;
  } catch (err) {
    stats.parseDirectly = false;
    stats.parseError = {
      message: err.message,
      line: err.line,
      column: err.column
    };
    stats.findings.push(
      `CRITICAL (P0): result.lua failed direct parsing: ${err.message}. Generator emitted IIFE function expression without required wrapping parentheses '(function(...) ... end)(...)'.`
    );

    // Try parsing with parenthesized IIFE for structural analysis
    const patchedCode = code.replace(
      /return function\(A, L, K, u, y, s, d, v, R, o, I, X, Y, x, j, m, t, S, p, r, e, f, Q, U, G\)([\s\S]*?)end\(getfenv/m,
      'return (function(A, L, K, u, y, s, d, v, R, o, I, X, Y, x, j, m, t, S, p, r, e, f, Q, U, G)$1end)(getfenv'
    );
    try {
      ast = parse(patchedCode);
    } catch (err2) {
      console.error('Failed patched parsing as well:', err2.message);
    }
  }

  if (ast) {
    for (const type of Object.values(ASTNodeType)) {
      stats.nodeCounts[type] = 0;
    }

    const closureHelperNames = new Set(['S', 'f', 'R', 'x', 'o', 'I', 'm', 'G', 'r', 'v', 'p']);

    traverse(ast, {
      enter(node) {
        if (node.type) {
          stats.nodeCounts[node.type] = (stats.nodeCounts[node.type] || 0) + 1;
        }

        if (node.type === ASTNodeType.WhileStatement &&
            node.condition.type === ASTNodeType.Identifier &&
            node.condition.name === 'Q') {
          stats.dispatcherRemaining = true;
        }

        if (node.type === ASTNodeType.CallExpression &&
            node.base.type === ASTNodeType.Identifier &&
            closureHelperNames.has(node.base.name)) {
          const firstArg = node.arguments[0];
          if (firstArg && firstArg.type === ASTNodeType.NumericLiteral) {
            stats.closureConstructorsFound.push({
              helper: node.base.name,
              targetState: firstArg.value
            });
          }
        }
      }
    });

    if (stats.closureConstructorsFound.length > 0) {
      stats.prunedPayloadDetected = true;
      stats.findings.push(
        `CRITICAL (P0): Found ${stats.closureConstructorsFound.length} closure constructor calls in the entry path (targeting states: ${stats.closureConstructorsFound.map(c => c.targetState).join(', ')}). In the current engine, reachability was only calculated from entry state 13548685, causing all inner closure function bodies (596 states) to be falsely categorized as unreachable and stripped!`
      );
    }
  }

  const outPath = path.resolve(__dirname, 'result-structure.json');
  fs.writeFileSync(outPath, JSON.stringify(stats, null, 2), 'utf8');
  console.log('Wrote audit/result-structure.json');
  return stats;
}

if (require.main === module) {
  auditResultStructure();
}

module.exports = { auditResultStructure };
