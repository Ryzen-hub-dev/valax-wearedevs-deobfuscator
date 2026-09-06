const { ASTNodeType, stringLiteral } = require('../ast/nodes');
const { transform } = require('../ast/visitor');
const { ConstantEvaluator } = require('../evaluator/constant-evaluator');

class StringRecoveryTransform {
  constructor(adapter) {
    this.adapter = adapter;
    this.evaluator = new ConstantEvaluator();
    this.stats = {
      stringsInlined: 0
    };
  }

  run(astChunk) {
    if (!this.adapter || !this.adapter.stringTable || this.adapter.stringTable.length === 0) {
      return { ast: astChunk, stats: this.stats };
    }

    const accessorName = this.adapter.accessorName || 'W';

    const transformed = transform(astChunk, (node) => {
      // 1. Match W(offset)
      if (node.type === ASTNodeType.CallExpression &&
          node.base.type === ASTNodeType.Identifier &&
          node.base.name === accessorName &&
          node.arguments.length === 1) {
        const foldedArg = this.evaluator.fold(node.arguments[0]);
        if (foldedArg.type === ASTNodeType.NumericLiteral) {
          const resolved = this.adapter.resolveLookup(foldedArg.value);
          if (resolved !== null) {
            this.stats.stringsInlined++;
            return stringLiteral(resolved);
          }
        }
      }

      // 2. Match A[index] (where index is 1-based constant)
      if (node.type === ASTNodeType.IndexExpression &&
          node.base.type === ASTNodeType.Identifier &&
          node.base.name === 'A') {
        const foldedIndex = this.evaluator.fold(node.index);
        if (foldedIndex.type === ASTNodeType.NumericLiteral) {
          const idx = foldedIndex.value - 1;
          if (idx >= 0 && idx < this.adapter.stringTable.length) {
            const resolved = this.adapter.stringTable[idx];
            if (resolved) {
              this.stats.stringsInlined++;
              return stringLiteral(resolved);
            }
          }
        }
      }

      return undefined;
    });

    return { ast: transformed, stats: this.stats };
  }
}

module.exports = { StringRecoveryTransform };
