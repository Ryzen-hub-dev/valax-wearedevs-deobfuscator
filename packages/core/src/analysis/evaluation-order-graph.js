/**
 * EvaluationOrderGraph:
 * Explicitly tracks and proves partial evaluation ordering of stateful operations
 * and observable side effects.
 */

class EvaluationOrderNode {
  constructor(id, operationType, metadata = {}) {
    this.id = id;
    this.operationType = operationType;
    this.metadata = metadata;
    this.predecessors = new Set();
    this.successors = new Set();
  }
}

class EvaluationOrderGraph {
  constructor() {
    this.nodes = new Map(); // id -> EvaluationOrderNode
  }

  addNode(id, operationType, metadata = {}) {
    if (!this.nodes.has(id)) {
      this.nodes.set(id, new EvaluationOrderNode(id, operationType, metadata));
    }
    return this.nodes.get(id);
  }

  addEdge(fromId, toId) {
    const fromNode = this.nodes.get(fromId);
    const toNode = this.nodes.get(toId);
    if (fromNode && toNode) {
      fromNode.successors.add(toId);
      toNode.predecessors.add(fromId);
    }
  }

  isAcyclic() {
    const visited = new Set();
    const recursionStack = new Set();

    const dfs = (nodeId) => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        for (const succId of node.successors) {
          if (!visited.has(succId)) {
            if (dfs(succId)) return true;
          } else if (recursionStack.has(succId)) {
            return true; // cycle detected
          }
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) return false;
      }
    }
    return true;
  }

  getTopologicalOrder() {
    if (!this.isAcyclic()) {
      throw new Error('EVALUATION_ORDER_UNPROVEN: Cycle detected in evaluation order graph');
    }

    const inDegree = new Map();
    for (const [id, node] of this.nodes.entries()) {
      inDegree.set(id, node.predecessors.size);
    }

    const queue = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }

    const order = [];
    while (queue.length > 0) {
      const u = queue.shift();
      order.push(u);

      const node = this.nodes.get(u);
      if (node) {
        for (const v of node.successors) {
          inDegree.set(v, inDegree.get(v) - 1);
          if (inDegree.get(v) === 0) {
            queue.push(v);
          }
        }
      }
    }

    return order;
  }
}

module.exports = { EvaluationOrderNode, EvaluationOrderGraph };
