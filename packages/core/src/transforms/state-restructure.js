const { ASTNodeType, ifStatement, whileStatement, assignmentStatement } = require('../ast/nodes');
const { EdgeType } = require('../cfg/edge');

class StateMachineRestructurer {
  /**
   * @param {ControlFlowGraph} cfg
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.confidence = 'UNKNOWN'; // 'PROVEN', 'LIKELY', 'UNKNOWN'
    this.stats = {
      sequentialCollapsed: 0,
      conditionalsRecovered: 0,
      loopsRecovered: 0,
      unreachableBlocksRemoved: 0
    };
  }

  /**
   * Clean out state-variable assignments (e.g. Q = ...) from statement lists.
   * @param {object[]} statements
   * @param {string} stateVar
   */
  stripStateAssignments(statements, stateVar) {
    return statements.filter(stmt => {
      if (stmt.type === ASTNodeType.AssignmentStatement &&
          stmt.variables.length === 1 &&
          stmt.variables[0].type === ASTNodeType.Identifier &&
          stmt.variables[0].name === stateVar) {
        return false;
      }
      return true;
    });
  }

  /**
   * Restructure the CFG into a list of high-level AST statements.
   * @param {number | string} [entryBlockId]
   */
  restructure(entryBlockId) {
    const reachability = this.cfg.computeReachability(entryBlockId);
    this.stats.unreachableBlocksRemoved = reachability.unreachable;

    const startBlock = entryBlockId !== undefined ? this.cfg.getBlock(entryBlockId) : this.cfg.entry;
    if (!startBlock) {
      return { statements: [], confidence: 'UNKNOWN', stats: this.stats };
    }

    const visited = new Set();
    const activePath = new Set();

    const walk = (block) => {
      if (!block || visited.has(block.id)) return [];

      // Check for loop back-edge
      if (activePath.has(block.id)) {
        this.stats.loopsRecovered++;
        return [];
      }

      visited.add(block.id);
      activePath.add(block.id);

      const stmts = this.stripStateAssignments(block.statements, this.cfg.dispatcherVar);

      // Case 1: Terminal block or no successors
      if (block.successors.length === 0) {
        activePath.delete(block.id);
        return stmts;
      }

      // Case 2: Unconditional single successor
      if (block.successors.length === 1 && block.successors[0].type === EdgeType.UNCONDITIONAL) {
        const nextBlock = block.successors[0].target;
        this.stats.sequentialCollapsed++;
        const nextStmts = walk(nextBlock);
        activePath.delete(block.id);
        return [...stmts, ...nextStmts];
      }

      // Case 3: Conditional branch (True / False)
      const trueEdge = block.successors.find(e => e.type === EdgeType.CONDITIONAL_TRUE);
      const falseEdge = block.successors.find(e => e.type === EdgeType.CONDITIONAL_FALSE);

      if (trueEdge && falseEdge) {
        this.stats.conditionalsRecovered++;
        const trueBlock = trueEdge.target;
        const falseBlock = falseEdge.target;

        const trueBranchStmts = walk(trueBlock);
        const falseBranchStmts = walk(falseBlock);

        const condition = trueEdge.condition || block.stateTransitions[0]?.condition;
        if (condition) {
          const ifNode = ifStatement(
            [{ condition, body: trueBranchStmts }],
            falseBranchStmts.length > 0 ? falseBranchStmts : null
          );
          stmts.push(ifNode);
        } else {
          stmts.push(...trueBranchStmts, ...falseBranchStmts);
        }

        activePath.delete(block.id);
        return stmts;
      }

      // Fallback: multiple successors
      for (const edge of block.successors) {
        stmts.push(...walk(edge.target));
      }

      activePath.delete(block.id);
      return stmts;
    };

    const structuredStatements = walk(startBlock);

    if (reachability.reachable > 0 && reachability.unreachable > 0) {
      this.confidence = 'PROVEN';
    } else if (reachability.reachable > 0) {
      this.confidence = 'LIKELY';
    } else {
      this.confidence = 'UNKNOWN';
    }

    return {
      statements: structuredStatements,
      confidence: this.confidence,
      stats: this.stats
    };
  }
}

module.exports = { StateMachineRestructurer };
