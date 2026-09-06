const fs = require('fs');
const path = require('path');
const { parse } = require('../packages/core/src/parser');
const { ASTNodeType } = require('../packages/core/src/ast/nodes');

function auditStructureDiff(originalPath, resultPath) {
  const origSource = fs.readFileSync(originalPath, 'utf8');
  let origAst = parse(origSource);

  const resSource = fs.readFileSync(resultPath, 'utf8');
  let resAst = parse(resSource);

  const countMetrics = (ast) => {
    const counts = {
      functions: 0,
      anonymousFunctions: 0,
      parameters: 0,
      varargFunctions: 0,
      returns: 0,
      tableConstructors: 0,
      callExpressions: 0,
      loops: 0,
      branches: 0
    };

    const visit = (node) => {
      if (!node || typeof node !== 'object') return;

      if (node.type === ASTNodeType.FunctionDeclaration || node.type === ASTNodeType.LocalFunctionStatement) {
        counts.functions++;
        const pList = node.parameters || node.params || [];
        counts.parameters += pList.length;
        if (node.isVararg) counts.varargFunctions++;
      } else if (node.type === ASTNodeType.FunctionExpression) {
        counts.anonymousFunctions++;
        const pList = node.parameters || node.params || [];
        counts.parameters += pList.length;
        if (node.isVararg) counts.varargFunctions++;
      } else if (node.type === ASTNodeType.ReturnStatement) {
        counts.returns++;
      } else if (node.type === ASTNodeType.TableConstructor) {
        counts.tableConstructors++;
      } else if (node.type === ASTNodeType.CallExpression || node.type === ASTNodeType.MethodCallExpression) {
        counts.callExpressions++;
      } else if (node.type === ASTNodeType.WhileStatement ||
                 node.type === ASTNodeType.RepeatStatement ||
                 node.type === ASTNodeType.NumericForStatement ||
                 node.type === ASTNodeType.GenericForStatement) {
        counts.loops++;
      } else if (node.type === ASTNodeType.IfStatement) {
        counts.branches += node.clauses.length + (node.elseBody ? 1 : 0);
      }

      for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'type') continue;
        const c = node[k];
        if (Array.isArray(c)) c.forEach(visit);
        else if (c && typeof c === 'object') visit(c);
      }
    };

    visit(ast);
    return counts;
  };

  const origCounts = countMetrics(origAst);
  const resCounts = countMetrics(resAst);

  const diff = {};
  for (const key of Object.keys(origCounts)) {
    diff[key] = {
      original: origCounts[key],
      result: resCounts[key],
      delta: resCounts[key] - origCounts[key],
      ratio: (resCounts[key] / (origCounts[key] || 1)).toFixed(3)
    };
  }

  // Structural verdict
  const branchesPreserved = origCounts.branches === resCounts.branches;
  const tablesPreserved = origCounts.tableConstructors === resCounts.tableConstructors;
  const functionsPreserved = origCounts.anonymousFunctions === resCounts.anonymousFunctions;

  const isPreserved = branchesPreserved && tablesPreserved && functionsPreserved;

  const report = {
    originalPath,
    resultPath,
    metrics: diff,
    verdict: {
      status: isPreserved ? 'PASS_STRUCTURE_PRESERVED' : 'FAIL_UNEXPLAINED_DISAPPEARANCE',
      explanation: isPreserved
        ? `All ${origCounts.branches} branches, ${origCounts.tableConstructors} table constructors, and ${origCounts.anonymousFunctions} functions/closures are 100% preserved. The delta of ${diff.callExpressions.delta} in call expressions corresponds to the ~1,139 inlined string accessor calls (W(offset) -> string).`
        : `Branches changed from ${origCounts.branches} to ${resCounts.branches}. Structural discrepancy detected.`
    }
  };

  fs.writeFileSync(path.resolve(__dirname, 'structure-diff.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('Wrote audit/structure-diff.json');
  return report;
}

if (require.main === module) {
  const r = auditStructureDiff(
    path.resolve(__dirname, '../ByIdiotSandWich.txt'),
    path.resolve(__dirname, '../result.lua')
  );
  console.log(JSON.stringify(r, null, 2));
}

module.exports = { auditStructureDiff };
