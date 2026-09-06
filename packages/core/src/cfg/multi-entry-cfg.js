const { EdgeType } = require('./edge');
const { BasicBlock } = require('./basic-block');
const { ControlFlowGraph } = require('./cfg');

class AbstractContext {
  constructor(bindings = new Map()) {
    this.bindings = new Map(bindings); // varName -> Set of possible values
  }

  set(name, value) {
    if (!this.bindings.has(name)) {
      this.bindings.set(name, new Set());
    }
    this.bindings.get(name).add(value);
  }

  merge(other) {
    const merged = new Map(this.bindings);
    for (const [k, vals] of other.bindings) {
      if (!merged.has(k)) {
        merged.set(k, new Set());
      }
      for (const v of vals) {
        merged.get(k).add(v);
      }
    }
    return new AbstractContext(merged);
  }

  key() {
    const entries = Array.from(this.bindings.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, set]) => `${k}=${Array.from(set).sort().join(',')}`);
    return entries.join(';');
  }
}

class MultiEntryCFGAnalyzer {
  /**
   * @param {ControlFlowGraph} sharedCFG
   * @param {Array<FunctionContext>} functionContexts
   */
  constructor(sharedCFG, functionContexts) {
    this.sharedCFG = sharedCFG;
    this.functionContexts = functionContexts;
    this.stateOwnership = new Map(); // stateId -> Set<functionId>
    this.stateClassification = new Map(); // stateId -> 'EXCLUSIVE' | 'SHARED' | 'UNRESOLVED'
  }

  /**
   * Run context-sensitive multi-entry CFG traversal for all function contexts.
   */
  analyze() {
    for (const func of this.functionContexts) {
      if (func.entryState === null) continue;

      const entryBlock = this.findBlockForState(func.entryState);
      if (!entryBlock) continue;

      const visited = new Set(); // stateId -> AbstractContext
      const worklist = [{ block: entryBlock, ctx: new AbstractContext() }];

      while (worklist.length > 0) {
        const { block, ctx } = worklist.shift();
        const ctxKey = `${block.id}:${ctx.key()}`;

        if (visited.has(ctxKey)) continue;
        visited.add(ctxKey);

        // Record state ownership
        func.addReachableState(block.id, 'PROVEN');
        if (!this.stateOwnership.has(block.id)) {
          this.stateOwnership.set(block.id, new Set());
        }
        this.stateOwnership.get(block.id).add(func.id);

        // Check if block has return boundary
        if (block.isExit || this.hasReturnStatement(block)) {
          func.addReturnState(block.id);
        }

        // Propagate transitions (Phase 8: Transition solver)
        for (const edge of block.successors) {
          const target = edge.target;
          if (!target) continue;

          if (edge.type === EdgeType.UNCONDITIONAL) {
            worklist.push({ block: target, ctx });
          } else if (edge.type === EdgeType.CONDITIONAL_TRUE || edge.type === EdgeType.CONDITIONAL_FALSE) {
            const nextCtx = new AbstractContext(ctx.bindings);
            if (edge.condition) {
              nextCtx.set('last_cond', edge.type === EdgeType.CONDITIONAL_TRUE ? 1 : 0);
            }
            worklist.push({ block: target, ctx: nextCtx });
          } else if (edge.type === EdgeType.DYNAMIC) {
            func.addReachableState(target.id, 'UNRESOLVED');
          }
        }
      }

      // Compute SCCs (Phase 12)
      func.sccs = this.computeSCCs(func);

      // Compute Dominators (Phase 13)
      this.computeDominators(func, entryBlock.id);
    }

    // Classify all states (Phase 9: State ownership)
    for (const [id] of this.sharedCFG.blocks.entries()) {
      const owners = this.stateOwnership.get(id);
      if (!owners || owners.size === 0) {
        this.stateClassification.set(id, 'UNRESOLVED');
      } else if (owners.size === 1) {
        this.stateClassification.set(id, 'EXCLUSIVE');
      } else {
        this.stateClassification.set(id, 'SHARED');
      }
    }

    return {
      stateOwnership: this.stateOwnership,
      stateClassification: this.stateClassification
    };
  }

  findBlockForState(stateId) {
    if (this.sharedCFG.hasBlock(stateId)) {
      return this.sharedCFG.getBlock(stateId);
    }
    for (const b of this.sharedCFG.blocks.values()) {
      if (b.minState !== undefined && stateId >= b.minState && stateId < b.maxState) {
        return b;
      }
    }
    return null;
  }

  hasReturnStatement(block) {
    for (const stmt of block.statements) {
      if (stmt.type === 'ReturnStatement') return true;
    }
    return false;
  }

  /**
   * Tarjan's SCC algorithm restricted to a function context (Phase 12).
   * @param {FunctionContext} func
   */
  computeSCCs(func) {
    let index = 0;
    const stack = [];
    const indices = new Map();
    const lowlinks = new Map();
    const onStack = new Set();
    const sccs = [];

    const strongConnect = (blockId) => {
      indices.set(blockId, index);
      lowlinks.set(blockId, index);
      index++;
      stack.push(blockId);
      onStack.add(blockId);

      const block = this.sharedCFG.getBlock(blockId);
      if (block) {
        for (const edge of block.successors) {
          const succId = edge.target?.id;
          if (succId && func.reachableStates.has(succId)) {
            if (!indices.has(succId)) {
              strongConnect(succId);
              lowlinks.set(blockId, Math.min(lowlinks.get(blockId), lowlinks.get(succId)));
            } else if (onStack.has(succId)) {
              lowlinks.set(blockId, Math.min(lowlinks.get(blockId), indices.get(succId)));
            }
          }
        }
      }

      if (lowlinks.get(blockId) === indices.get(blockId)) {
        const scc = [];
        let w;
        do {
          w = stack.pop();
          onStack.delete(w);
          scc.push(w);
        } while (w !== blockId);
        if (scc.length > 1 || this.hasSelfLoop(blockId)) {
          sccs.push(scc);
        }
      }
    };

    for (const blockId of func.reachableStates) {
      if (!indices.has(blockId)) {
        strongConnect(blockId);
      }
    }

    return sccs;
  }

  hasSelfLoop(blockId) {
    const block = this.sharedCFG.getBlock(blockId);
    if (!block) return false;
    return block.successors.some(e => e.target?.id === blockId);
  }

  /**
   * Iterative Dominator calculation for a FunctionContext (Phase 13).
   * @param {FunctionContext} func
   * @param {number|string} entryId
   */
  computeDominators(func, entryId) {
    const reachable = Array.from(func.reachableStates);
    const allStates = new Set(reachable);

    const dom = new Map();
    for (const s of reachable) {
      dom.set(s, s === entryId ? new Set([entryId]) : new Set(reachable));
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const s of reachable) {
        if (s === entryId) continue;
        const block = this.sharedCFG.getBlock(s);
        if (!block) continue;

        // Predecessors in this function context
        const preds = block.predecessors
          .map(e => e.source.id)
          .filter(id => func.reachableStates.has(id));

        if (preds.length === 0) continue;

        // Intersection of dom(p) for all p in preds
        let newDom = new Set(dom.get(preds[0]) || []);
        for (let i = 1; i < preds.length; i++) {
          const pDom = dom.get(preds[i]);
          if (pDom) {
            newDom = new Set([...newDom].filter(x => pDom.has(x)));
          }
        }
        newDom.add(s);

        const currentDom = dom.get(s);
        if (newDom.size !== currentDom.size) {
          dom.set(s, newDom);
          changed = true;
        }
      }
    }

    func.dominators = dom;

    // Compute immediate dominators (idom)
    for (const s of reachable) {
      if (s === entryId) continue;
      const sDom = new Set(dom.get(s));
      sDom.delete(s);

      // Find the dominator d in sDom that doesn't dominate any other dominator in sDom
      for (const d of sDom) {
        let isImmediate = true;
        for (const other of sDom) {
          if (other !== d && dom.get(other)?.has(d)) {
            isImmediate = false;
            break;
          }
        }
        if (isImmediate) {
          func.immediateDominators.set(s, d);
          break;
        }
      }
    }
  }
}

module.exports = {
  AbstractContext,
  MultiEntryCFGAnalyzer
};
