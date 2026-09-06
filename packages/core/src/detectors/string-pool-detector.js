const { ASTNodeType } = require('../ast/nodes');

class StringPoolDetector {
  /**
   * Scans an AST to find candidate string pool tables.
   * A candidate string pool table is a table with a large number of string literals.
   * @param {object} astChunk
   * @param {number} minStrings
   */
  detectCandidates(astChunk, minStrings = 20) {
    const candidates = [];

    const visit = (node, parent) => {
      if (!node || typeof node !== 'object') return;

      if (node.type === ASTNodeType.LocalStatement) {
        for (let i = 0; i < node.init.length; i++) {
          const init = node.init[i];
          if (init && init.type === ASTNodeType.TableConstructor) {
            let strCount = 0;
            for (const f of init.fields) {
              if (f.value && f.value.type === ASTNodeType.StringLiteral) {
                strCount++;
              }
            }
            if (strCount >= minStrings) {
              const varName = node.variables[i] ? node.variables[i].name : 'unknown';
              candidates.push({
                variableName: varName,
                totalFields: init.fields.length,
                stringCount: strCount,
                node: init,
                statement: node
              });
            }
          }
        }
      }

      for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'type') continue;
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(c => visit(c, node));
        } else if (child && typeof child === 'object') {
          visit(child, node);
        }
      }
    };

    visit(astChunk, null);
    return candidates;
  }
}

module.exports = { StringPoolDetector };
