const crypto = require('crypto');
const { ASTNodeType } = require('../ast/nodes');
const { DispatcherAnalyzer } = require('../cfg/dispatcher');
const { ClosureConstructorAnalyzer } = require('../analysis/closure-analyzer');
const { WeAreDevsAdapter } = require('./wearedevs/wearedevs-adapter');

class StructuralFingerprint {
  constructor() {
    this.dispatcherAnalyzer = new DispatcherAnalyzer();
    this.closureAnalyzer = new ClosureConstructorAnalyzer();
    this.adapter = new WeAreDevsAdapter();
  }

  /**
   * Generates a structural fingerprint for an AST chunk.
   * @param {object} astChunk
   * @param {string} [rawSource]
   */
  extract(astChunk, rawSource = '') {
    // 1. Adapter analysis
    let stringPoolShape = { size: 0, isArray: false };
    let alphabetHash = null;
    let decoderShape = { parameterCount: 0, hasOffsetArithmetic: false };

    try {
      const adapterSuccess = this.adapter.extractAndDecode(astChunk);
      if (adapterSuccess) {
        stringPoolShape = {
          size: this.adapter.stats.stringsFound,
          isArray: true,
          rotationRangesCount: this.adapter.stats.rotationRangesApplied
        };
        if (this.adapter.alphabet) {
          const sortedKeys = Array.from(this.adapter.alphabet.keys()).sort();
          const alphaStr = sortedKeys.map(k => `${k}:${this.adapter.alphabet.get(k)}`).join(',');
          alphabetHash = crypto.createHash('sha256').update(alphaStr).digest('hex');
        }
        decoderShape = {
          parameterCount: 1,
          hasOffsetArithmetic: this.adapter.accessorOffset !== null,
          accessorOffset: this.adapter.accessorOffset
        };
      }
    } catch (e) {
      // Ignored if not standard WeAreDevs
    }

    // 2. Dispatcher analysis
    const dispatchers = this.dispatcherAnalyzer.findDispatchers(astChunk);
    let dispatcherTopology = 'none';
    let dispatcherDepth = 0;
    let stateCount = 0;
    let transitionPatterns = { unconditional: 0, conditional: 0, dynamic: 0, terminal: 0 };

    if (dispatchers.length > 0) {
      dispatcherTopology = 'binary_search_tree';
      const disp = dispatchers[0];
      const cfg = this.dispatcherAnalyzer.buildCFG(disp.stateVar, disp.rootIf);
      stateCount = cfg.blocks.size;

      // Compute max depth of binary search tree
      const getDepth = (node) => {
        if (!node || node.type !== ASTNodeType.IfStatement) return 0;
        const thenBody = node.clauses[0]?.body;
        const elseBody = node.elseBody;
        const leftDepth = (thenBody && thenBody[0]?.type === ASTNodeType.IfStatement) ? getDepth(thenBody[0]) : 1;
        const rightDepth = (elseBody && elseBody[0]?.type === ASTNodeType.IfStatement) ? getDepth(elseBody[0]) : 1;
        return 1 + Math.max(leftDepth, rightDepth);
      };
      dispatcherDepth = getDepth(disp.rootIf);

      // Compute transition patterns
      for (const b of cfg.blocks.values()) {
        for (const t of b.stateTransitions) {
          if (t.type === 'unconditional') transitionPatterns.unconditional++;
          else if (t.type.includes('conditional')) transitionPatterns.conditional++;
          else if (t.type === 'dynamic') transitionPatterns.dynamic++;
        }
        if (b.isExit) transitionPatterns.terminal++;
      }
    }

    // 3. Closure factory analysis
    const constructors = this.closureAnalyzer.analyze(astChunk);
    const closureFactorySignatures = constructors.map(c => ({
      helper: c.helper,
      paramCount: c.paramCount,
      vararg: c.vararg,
      capturedCount: c.capturedValues.length
    }));

    // 4. Runtime alias shape
    let runtimeAliasCount = 0;
    const countAliases = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === ASTNodeType.LocalStatement && node.init.length > 0) {
        if (node.init[0].type === ASTNodeType.CallExpression &&
            node.init[0].base.type === ASTNodeType.Identifier &&
            (node.init[0].base.name === 'f' || node.init[0].base.name === 'unpack')) {
          runtimeAliasCount = node.variables.length;
        }
      }
      for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'type') continue;
        const child = node[k];
        if (Array.isArray(child)) child.forEach(countAliases);
        else if (child && typeof child === 'object') countAliases(child);
      }
    };
    countAliases(astChunk);

    return {
      stringPoolShape,
      decoderShape,
      alphabetHash,
      dispatcherTopology,
      dispatcherDepth,
      closureFactorySignatures: closureFactorySignatures.slice(0, 10), // Representative sample
      totalClosureConstructors: constructors.length,
      stateCount,
      runtimeAliasShape: { count: runtimeAliasCount },
      entryMechanism: 'direct_root_invocation',
      transitionPatterns
    };
  }
}

module.exports = { StructuralFingerprint };
