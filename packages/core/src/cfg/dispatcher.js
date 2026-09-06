const { ASTNodeType } = require('../ast/nodes');
const { BasicBlock } = require('./basic-block');
const { EdgeType } = require('./edge');
const { ControlFlowGraph } = require('./cfg');
const { ConstantEvaluator } = require('../evaluator/constant-evaluator');

class DispatcherAnalyzer {
  constructor() {
    this.evaluator = new ConstantEvaluator();
  }

  /**
   * Find candidate while-loop dispatchers in the AST.
   * @param {object} astChunk
   */
  findDispatchers(astChunk) {
    const dispatchers = [];

    const visit = (node) => {
      if (!node || typeof node !== 'object') return;

      if (node.type === ASTNodeType.WhileStatement) {
        if (node.condition.type === ASTNodeType.Identifier) {
          const stateVar = node.condition.name;
          // Check if body has a large binary-search if statement
          if (node.body.length > 0 && node.body[0].type === ASTNodeType.IfStatement) {
            dispatchers.push({
              stateVar,
              whileNode: node,
              rootIf: node.body[0]
            });
          }
        }
      }

      for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'type') continue;
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(visit);
        } else if (child && typeof child === 'object') {
          visit(child);
        }
      }
    };

    visit(astChunk);
    return dispatchers;
  }

  /**
   * Builds a ControlFlowGraph from a dispatcher while loop.
   * @param {string} stateVar
   * @param {object} rootIfNode
   * @param {number} [entryStateId]
   */
  buildCFG(stateVar, rootIfNode, entryStateId) {
    const cfg = new ControlFlowGraph(stateVar);
    let stateCounter = 0;

    // Collect all leaf blocks by traversing the binary search if tree
    const traverseTree = (node, minVal, maxVal) => {
      if (!node) return;

      // Decision node: if stateVar < threshold
      if (node.type === ASTNodeType.IfStatement &&
          node.clauses.length === 1 &&
          node.clauses[0].condition.type === ASTNodeType.BinaryExpression &&
          node.clauses[0].condition.operator === '<' &&
          node.clauses[0].condition.left.type === ASTNodeType.Identifier &&
          node.clauses[0].condition.left.name === stateVar) {

        const foldedThreshold = this.evaluator.fold(node.clauses[0].condition.right);
        let threshold = null;
        if (foldedThreshold.type === ASTNodeType.NumericLiteral) {
          threshold = foldedThreshold.value;
        }

        const thenBody = node.clauses[0].body;
        const elseBody = node.elseBody;

        if (thenBody && thenBody.length === 1 && thenBody[0].type === ASTNodeType.IfStatement) {
          traverseTree(thenBody[0], minVal, threshold !== null ? threshold : maxVal);
        } else {
          extractLeafBlock(thenBody, minVal, threshold !== null ? threshold : maxVal);
        }

        if (elseBody && elseBody.length === 1 && elseBody[0].type === ASTNodeType.IfStatement) {
          traverseTree(elseBody[0], threshold !== null ? threshold : minVal, maxVal);
        } else if (elseBody) {
          extractLeafBlock(elseBody, threshold !== null ? threshold : minVal, maxVal);
        }
        return;
      }

      // If it's not a single < if statement, it's a leaf block
      extractLeafBlock(Array.isArray(node) ? node : [node], minVal, maxVal);
    };

    const extractLeafBlock = (statements, minVal, maxVal) => {
      stateCounter++;
      // Determine state ID: if minVal and maxVal are close, or use integer interval
      let stateId;
      if (Number.isFinite(minVal) && Number.isFinite(maxVal)) {
        // e.g. [100, 101) => 100
        stateId = Math.floor((minVal + maxVal) / 2);
      } else if (Number.isFinite(minVal)) {
        stateId = minVal;
      } else if (Number.isFinite(maxVal)) {
        stateId = maxVal - 1;
      } else {
        stateId = stateCounter;
      }

      const block = new BasicBlock(stateId);
      block.minState = minVal;
      block.maxState = maxVal;

      const localConsts = new Map();
      let partialAnd = null;

      // Inspect statements in this leaf
      for (const stmt of statements) {
        block.addStatement(stmt);

        // Track constant assignments within the basic block
        if (stmt.type === ASTNodeType.AssignmentStatement &&
            stmt.variables.length === 1 &&
            stmt.variables[0].type === ASTNodeType.Identifier) {
          const vName = stmt.variables[0].name;
          const foldedInit = this.evaluator.fold(stmt.init[0]);
          if (foldedInit.type === ASTNodeType.NumericLiteral) {
            localConsts.set(vName, foldedInit.value);
          }

          // Check if this statement updates the stateVar (Q = ...)
          if (vName === stateVar) {
            const currentTransitions = [];

            // 1. Unconditional transition: Q = <number>
            if (foldedInit.type === ASTNodeType.NumericLiteral) {
              currentTransitions.push({
                targetState: foldedInit.value,
                type: EdgeType.UNCONDITIONAL
              });
              partialAnd = null;
            }
            // 2. Conditional transition: Q = cond and s1 or s2 (direct or split part 2)
            else if (foldedInit.type === ASTNodeType.LogicalExpression && foldedInit.operator === 'or') {
              const leftAnd = foldedInit.left;
              const rightRhs = this.evaluator.fold(foldedInit.right);
              let s2 = rightRhs.type === ASTNodeType.NumericLiteral ? rightRhs.value : (rightRhs.type === ASTNodeType.Identifier ? localConsts.get(rightRhs.name) : undefined);

              if (leftAnd.type === ASTNodeType.LogicalExpression && leftAnd.operator === 'and') {
                const cond = leftAnd.left;
                const leftRhs = this.evaluator.fold(leftAnd.right);
                let s1 = leftRhs.type === ASTNodeType.NumericLiteral ? leftRhs.value : (leftRhs.type === ASTNodeType.Identifier ? localConsts.get(leftRhs.name) : undefined);

                if (typeof s1 === 'number' && typeof s2 === 'number') {
                  currentTransitions.push({
                    targetState: s1,
                    condition: cond,
                    type: EdgeType.CONDITIONAL_TRUE
                  });
                  currentTransitions.push({
                    targetState: s2,
                    condition: cond,
                    type: EdgeType.CONDITIONAL_FALSE
                  });
                  partialAnd = null;
                }
              } else if (partialAnd && typeof s2 === 'number') {
                currentTransitions.push({
                  targetState: partialAnd.s1,
                  condition: partialAnd.cond,
                  type: EdgeType.CONDITIONAL_TRUE
                });
                currentTransitions.push({
                  targetState: s2,
                  condition: partialAnd.cond,
                  type: EdgeType.CONDITIONAL_FALSE
                });
                partialAnd = null;
              }
            }
            // 3. Split ternary part 1: Q = cond and s1
            else if (foldedInit.type === ASTNodeType.LogicalExpression && foldedInit.operator === 'and') {
              const cond = foldedInit.left;
              const s1Node = this.evaluator.fold(foldedInit.right);
              let s1 = s1Node.type === ASTNodeType.NumericLiteral ? s1Node.value : (s1Node.type === ASTNodeType.Identifier ? localConsts.get(s1Node.name) : undefined);
              if (typeof s1 === 'number') {
                partialAnd = { cond, s1 };
              }
            }
            // 4. Terminal transition: Q = false / nil / loop termination
            else if ((foldedInit.type === ASTNodeType.BooleanLiteral && foldedInit.value === false) ||
                     foldedInit.type === ASTNodeType.NilLiteral) {
              block.isExit = true;
              currentTransitions.length = 0;
              partialAnd = null;
            }
            // 5. Dynamic/Table transition
            else {
              currentTransitions.push({
                targetState: 'DYNAMIC',
                type: EdgeType.DYNAMIC,
                expression: foldedInit
              });
              partialAnd = null;
            }

            if (currentTransitions.length > 0) {
              block.stateTransitions = currentTransitions;
            }
          }
        }
      }

      cfg.addBlock(block);
    };

    traverseTree(rootIfNode, -Infinity, Infinity);

    // If entryStateId specified, connect entry
    if (entryStateId !== undefined) {
      // Find the block whose interval contains entryStateId
      for (const block of cfg.blocks.values()) {
        if (entryStateId >= block.minState && entryStateId < block.maxState) {
          cfg.entry = block;
          block.isEntry = true;
          break;
        }
      }
    }

    // Connect edges between blocks based on transitions
    for (const sourceBlock of cfg.blocks.values()) {
      for (const trans of sourceBlock.stateTransitions) {
        if (typeof trans.targetState === 'number') {
          // Find matching block
          let targetBlock = null;
          for (const b of cfg.blocks.values()) {
            if (trans.targetState >= b.minState && trans.targetState < b.maxState) {
              targetBlock = b;
              break;
            }
          }
          if (targetBlock) {
            cfg.addEdge(sourceBlock, targetBlock, trans.type, trans.condition);
          }
        }
      }
      if (sourceBlock.isExit) {
        cfg.exits.push(sourceBlock);
      }
    }

    return cfg;
  }
}

module.exports = { DispatcherAnalyzer };
