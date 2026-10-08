const { ASTNodeType, identifier, memberExpression } = require('../ast/nodes');
const { transform, traverse } = require('../ast/visitor');
const { KnownBuiltin, STANDARD_BUILTINS } = require('../analysis/alias');
const { ByteString } = require('../../../shared/src');

class AliasRecoveryTransform {
  constructor(options = {}) {
    this.envVarNames = new Set(options.envVarNames || ['A']);
    this.knownAliases = new Map();
    this.stats = {
      aliasesRecovered: 0,
      envLookupsResolved: 0
    };
  }

  /**
   * Scan for alias definitions in the AST.
   * @param {object} astChunk
   */
  findAliases(astChunk) {
    traverse(astChunk, { enter: node => {
      // local x = lib.func
      if (node.type === ASTNodeType.LocalStatement && node.variables.length === node.init.length) {
        for (let i = 0; i < node.variables.length; i++) {
          const v = node.variables[i];
          const init = node.init[i];

          if (init.type === ASTNodeType.MemberExpression &&
              init.base.type === ASTNodeType.Identifier &&
              init.property.type === ASTNodeType.Identifier) {
            const fullName = `${init.base.name}.${init.property.name}`;
            this.knownAliases.set(v.name, new KnownBuiltin(fullName));
            this.stats.aliasesRecovered++;
          } else if (init.type === ASTNodeType.Identifier && STANDARD_BUILTINS.has(init.name)) {
            this.knownAliases.set(v.name, new KnownBuiltin(init.name));
            this.stats.aliasesRecovered++;
          }
        }
      }

    } });
  }

  /**
   * Rewrite alias uses in the AST.
   * @param {object} astChunk
   */
  run(astChunk) {
    this.findAliases(astChunk);

    const transformed = transform(astChunk, (node) => {
      // 1. Rewrite environment indexing: env["print"] -> print
      if (node.type === ASTNodeType.IndexExpression &&
          node.base.type === ASTNodeType.Identifier &&
          this.envVarNames.has(node.base.name) &&
          node.index.type === ASTNodeType.StringLiteral) {
        let strVal = node.index.value;
        if (strVal instanceof ByteString) strVal = strVal.toString('latin1');
        if (typeof strVal === 'string' && STANDARD_BUILTINS.has(strVal)) {
          this.stats.envLookupsResolved++;
          return identifier(strVal);
        }
      }

      // 2. Rewrite call expressions: alias(arg1, arg2) -> lib.func(arg1, arg2)
      if (node.type === ASTNodeType.CallExpression &&
          node.base.type === ASTNodeType.Identifier &&
          this.knownAliases.has(node.base.name)) {
        const builtin = this.knownAliases.get(node.base.name);
        const parts = builtin.name.split('.');
        if (parts.length === 2) {
          node.base = memberExpression(identifier(parts[0]), identifier(parts[1]));
        } else {
          node.base = identifier(builtin.name);
        }
      }

      return undefined;
    });

    return { ast: transformed, stats: this.stats };
  }
}

module.exports = { AliasRecoveryTransform };
