/**
 * VMDependencyGraph:
 * Scans an AST chunk to verify complete detachment from the virtual machine runtime,
 * dispatcher, registers, decoder routines, and helper constructors.
 */

const { ASTNodeType } = require('../ast/nodes');

class VMDependencyGraph {
  constructor() {}

  /**
   * Analyze whether the given AST contains any remaining references to VM runtime structures.
   *
   * @param {object} astChunk
   * @param {string} [dispatcherVar='G']
   * @returns {object} { vmDependency: object, detached: boolean }
   */
  analyze(astChunk, dispatcherVar = 'G') {
    const stats = {
      dispatcherReferences: 0,
      vmRegisterReferences: 0,
      runtimeHelperReferences: 0,
      decoderReferences: 0,
      vmTupleTransportReferences: 0,
      vmClosureHelperReferences: 0,
      detached: false
    };

    if (!astChunk) {
      return { vmDependency: stats, detached: false };
    }

    const vmRegisters = new Set(['b', 'k']);
    const vmHelpers = new Set(['M', 'X', 'Y', 'Q', 'W', 'o']);

    const walk = (node) => {
      if (!node) return;

      // 1. Check Dispatcher variable reference
      if (node.type === ASTNodeType.Identifier && node.name === dispatcherVar) {
        stats.dispatcherReferences++;
      }

      // 2. Check VM register indexing (e.g. b[...] or k[...])
      if (node.type === ASTNodeType.MemberExpression || node.type === ASTNodeType.IndexExpression) {
        if (node.base && node.base.type === ASTNodeType.Identifier && vmRegisters.has(node.base.name)) {
          stats.vmRegisterReferences++;
        }
      }

      // 3. Check Calls
      if (node.type === ASTNodeType.CallExpression) {
        if (node.base && node.base.type === ASTNodeType.Identifier) {
          if (vmHelpers.has(node.base.name)) {
            stats.runtimeHelperReferences++;
          }
          if (node.base.name === 'l' || node.base.name === 'H' || node.base.name === 'K' || node.base.name === 'V' || node.base.name === 'C') {
            stats.decoderReferences++;
          }
          if (node.base.name === 'U') {
            stats.vmTupleTransportReferences++;
          }
        }
      }

      for (const key of Object.keys(node)) {
        if (key === 'parent') continue;
        const val = node[key];
        if (Array.isArray(val)) {
          val.forEach(walk);
        } else if (val && typeof val === 'object' && val.type) {
          walk(val);
        }
      }
    };

    walk(astChunk);

    stats.detached = (
      stats.dispatcherReferences === 0 &&
      stats.vmRegisterReferences === 0 &&
      stats.runtimeHelperReferences === 0 &&
      stats.decoderReferences === 0 &&
      stats.vmTupleTransportReferences === 0 &&
      stats.vmClosureHelperReferences === 0
    );

    return {
      vmDependency: stats,
      detached: stats.detached
    };
  }
}

module.exports = { VMDependencyGraph };
