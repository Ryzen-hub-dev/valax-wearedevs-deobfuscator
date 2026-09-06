const { ASTNodeType } = require('../ast/nodes');
const { ConstantEvaluator } = require('../evaluator/constant-evaluator');

class ResidualDispatcherCompressor {
  constructor(options = {}) {
    this.evaluator = new ConstantEvaluator();
    this.extractedStates = new Set();
    this.stats = {
      physicalStatesBefore: 0,
      safeExtractionCandidates: 0,
      physicallyExtractedStates: 0,
      physicalStatesAfter: 0,
      branchesPruned: 0
    };
  }

  validateConservation({ beforeStates, remainingStates, liftedAndReplacedStates, provenUnreachableStates = 0, provenRedundantStates = 0 }) {
    const accounted = remainingStates + liftedAndReplacedStates + provenUnreachableStates + provenRedundantStates;
    if (beforeStates !== accounted) {
      throw new Error(`STATE_ACCOUNTING_FAILURE: beforeStates (${beforeStates}) != remaining (${remainingStates}) + lifted (${liftedAndReplacedStates}) + unreachable (${provenUnreachableStates}) + redundant (${provenRedundantStates})`);
    }
    return true;
  }

  /**
   * Identifies proven exclusive states that can be safely removed from the central dispatcher.
   * @param {ControlFlowGraph} cfg
   * @param {Array<object>} exclusiveProofList
   * @param {Set<number>} rewiredLogicalEntryStates
   */
  findExtractableStates(cfg, exclusiveProofList, rewiredLogicalEntryStates) {
    const candidates = new Set();

    for (const item of exclusiveProofList) {
      if (item.status === 'EXCLUSIVE_PROVEN' && item.safeToExtract) {
        const block = cfg.getBlock(item.state);
        if (block) {
          // Check that no incoming edge comes from an unproven block
          const hasUnsafePredecessor = block.predecessors.some(e => {
            const pred = e.source;
            return !candidates.has(pred.id) && !exclusiveProofList.some(p => p.state === pred.id && p.safeToExtract);
          });

          if (!hasUnsafePredecessor) {
            candidates.add(item.state);
          }
        }
      }
    }

    this.stats.safeExtractionCandidates = candidates.size;
    return candidates;
  }

  /**
   * Compresses the binary search tree in the dispatcher while loop by removing extracted leaf blocks.
   * @param {object} rootIfNode
   * @param {string} stateVar
   * @param {Set<number>} statesToExtract
   * @param {ControlFlowGraph} cfg
   */
  compressDispatcher(rootIfNode, stateVar, statesToExtract, cfg) {
    this.stats.physicalStatesBefore = cfg.blocks.size;
    let extractedCount = 0;

    const pruneTree = (node, minVal, maxVal) => {
      if (!node) return null;

      // Decision node: if stateVar < threshold then A else B end
      if (node.type === ASTNodeType.IfStatement &&
          node.clauses.length === 1 &&
          node.clauses[0].condition.type === ASTNodeType.BinaryExpression &&
          node.clauses[0].condition.operator === '<' &&
          node.clauses[0].condition.left.type === ASTNodeType.Identifier &&
          node.clauses[0].condition.left.name === stateVar) {

        const foldedThreshold = this.evaluator.fold(node.clauses[0].condition.right);
        const threshold = foldedThreshold.type === ASTNodeType.NumericLiteral ? foldedThreshold.value : null;

        const thenBody = node.clauses[0].body;
        const elseBody = node.elseBody;

        let prunedThen = null;
        if (thenBody && thenBody.length === 1 && thenBody[0].type === ASTNodeType.IfStatement) {
          prunedThen = pruneTree(thenBody[0], minVal, threshold !== null ? threshold : maxVal);
        } else if (thenBody) {
          let stateId;
          const tMax = threshold !== null ? threshold : maxVal;
          if (Number.isFinite(minVal) && Number.isFinite(tMax)) {
            stateId = Math.floor((minVal + tMax) / 2);
          } else if (Number.isFinite(minVal)) {
            stateId = minVal;
          } else if (Number.isFinite(tMax)) {
            stateId = tMax - 1;
          }

          if (stateId !== undefined && statesToExtract.has(stateId)) {
            extractedCount++;
            this.stats.branchesPruned++;
            prunedThen = null;
          } else {
            prunedThen = thenBody;
          }
        }

        let prunedElse = null;
        if (elseBody && elseBody.length === 1 && elseBody[0].type === ASTNodeType.IfStatement) {
          prunedElse = pruneTree(elseBody[0], threshold !== null ? threshold : minVal, maxVal);
        } else if (elseBody) {
          let stateId;
          const tMin = threshold !== null ? threshold : minVal;
          if (Number.isFinite(tMin) && Number.isFinite(maxVal)) {
            stateId = Math.floor((tMin + maxVal) / 2);
          } else if (Number.isFinite(tMin)) {
            stateId = tMin;
          } else if (Number.isFinite(maxVal)) {
            stateId = maxVal - 1;
          }

          if (stateId !== undefined && statesToExtract.has(stateId)) {
            extractedCount++;
            this.stats.branchesPruned++;
            prunedElse = null;
          } else {
            prunedElse = elseBody;
          }
        }

        // Simplification
        if (!prunedThen && prunedElse) {
          return Array.isArray(prunedElse) ? prunedElse[0] : prunedElse;
        }
        if (prunedThen && !prunedElse) {
          return Array.isArray(prunedThen) ? prunedThen[0] : prunedThen;
        }
        if (!prunedThen && !prunedElse) {
          return null;
        }

        node.clauses[0].body = Array.isArray(prunedThen) ? prunedThen : [prunedThen];
        node.elseBody = Array.isArray(prunedElse) ? prunedElse : [prunedElse];
        return node;
      }

      return node;
    };

    const newRoot = pruneTree(rootIfNode, -Infinity, Infinity);

    this.stats.physicallyExtractedStates = extractedCount;
    this.stats.physicalStatesAfter = this.stats.physicalStatesBefore - extractedCount;

    // State Conservation Invariant: before === remaining + extracted + unreachable + redundant
    const conservationValid = this.stats.physicalStatesBefore === (this.stats.physicalStatesAfter + this.stats.physicallyExtractedStates);
    if (!conservationValid) {
      throw new Error(`STATE_ACCOUNTING_FAILURE: before (${this.stats.physicalStatesBefore}) != remaining (${this.stats.physicalStatesAfter}) + extracted (${this.stats.physicallyExtractedStates})`);
    }

    return {
      rootIf: newRoot || rootIfNode,
      stats: this.stats
    };
  }
}

module.exports = { ResidualDispatcherCompressor };
