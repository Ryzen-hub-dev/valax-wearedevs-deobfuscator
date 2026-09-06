const { Edge, EdgeType } = require('./edge');

class ControlFlowGraph {
  constructor(dispatcherVar = 'Q') {
    this.dispatcherVar = dispatcherVar;
    this.blocks = new Map(); // id -> BasicBlock
    this.entry = null;
    this.exits = [];
    this.edges = [];
  }

  addBlock(block) {
    this.blocks.set(block.id, block);
    return block;
  }

  getBlock(id) {
    return this.blocks.get(id);
  }

  hasBlock(id) {
    return this.blocks.has(id);
  }

  addEdge(source, target, type = EdgeType.UNCONDITIONAL, condition = null) {
    const edge = new Edge(source, target, type, condition);
    source.addSuccessor(edge);
    target.addPredecessor(edge);
    this.edges.push(edge);
    return edge;
  }

  /**
   * Compute reachability starting from the entry block ID (or set of entry IDs).
   * @param {number | string | Array<number | string> | Set<number | string>} [entryBlockId]
   */
  computeReachability(entryBlockId) {
    const reachableSet = new Set();
    const queue = [];

    if (Array.isArray(entryBlockId) || entryBlockId instanceof Set) {
      for (const id of entryBlockId) {
        let b = this.getBlock(id);
        if (!b && typeof id === 'number') {
          for (const block of this.blocks.values()) {
            if (id >= block.minState && id < block.maxState) {
              b = block;
              break;
            }
          }
        }
        if (b && !reachableSet.has(b.id)) {
          reachableSet.add(b.id);
          queue.push(b);
        }
      }
    } else {
      const startBlock = entryBlockId !== undefined ? this.getBlock(entryBlockId) : this.entry;
      if (startBlock) {
        reachableSet.add(startBlock.id);
        queue.push(startBlock);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift();
      for (const edge of current.successors) {
        if (edge.target && !reachableSet.has(edge.target.id)) {
          reachableSet.add(edge.target.id);
          queue.push(edge.target);
        }
      }
    }

    const unreachable = [];
    for (const [id, block] of this.blocks.entries()) {
      if (!reachableSet.has(id)) {
        unreachable.push(id);
      }
    }

    let conditionalCount = 0;
    for (const edge of this.edges) {
      if (edge.type === EdgeType.CONDITIONAL_TRUE || edge.type === EdgeType.CONDITIONAL_FALSE) {
        conditionalCount++;
      }
    }

    return {
      dispatcherCandidate: this.dispatcherVar,
      states: this.blocks.size,
      reachable: reachableSet.size,
      unreachable: unreachable.length,
      transitions: this.edges.length,
      conditionalTransitions: conditionalCount,
      terminalStates: this.exits.length,
      reachableSet,
      unreachableSet: new Set(unreachable)
    };
  }
}

module.exports = { ControlFlowGraph };
