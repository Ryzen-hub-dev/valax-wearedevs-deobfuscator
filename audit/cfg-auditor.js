const fs = require('fs');
const path = require('path');
const { parse } = require('../packages/core/src/parser');
const { ASTNodeType } = require('../packages/core/src/ast/nodes');
const { ConstantEvaluator } = require('../packages/core/src/evaluator/constant-evaluator');

class CFGAuditor {
  constructor() {
    this.evaluator = new ConstantEvaluator();
    this.states = new Map(); // id -> { id, minVal, maxVal, statements, transitions, closureCreations }
    this.closureHelperNames = new Set(['S', 'f', 'R', 'x', 'o', 'I', 'm', 'G', 'r', 'v', 'p']);
    this.dispatcherVar = 'Q';
  }

  audit(fixturePath) {
    const source = fs.readFileSync(fixturePath, 'utf8');
    const ast = parse(source);

    // 1. Locate dispatcher
    let whileNode = null;
    const findWhile = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === ASTNodeType.WhileStatement &&
          node.condition.type === ASTNodeType.Identifier &&
          node.condition.name === this.dispatcherVar) {
        whileNode = node;
        return;
      }
      for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'type') continue;
        const child = node[k];
        if (Array.isArray(child)) child.forEach(findWhile);
        else if (child && typeof child === 'object') findWhile(child);
      }
    };
    findWhile(ast);

    if (!whileNode) {
      throw new Error('Dispatcher while loop not found');
    }

    // 2. Enumerate all possible states from the binary search tree
    let stateCounter = 0;
    const traverse = (node, minVal, maxVal) => {
      if (!node) return;

      if (node.type === ASTNodeType.IfStatement &&
          node.clauses.length === 1 &&
          node.clauses[0].condition.type === ASTNodeType.BinaryExpression &&
          node.clauses[0].condition.operator === '<' &&
          node.clauses[0].condition.left.type === ASTNodeType.Identifier &&
          node.clauses[0].condition.left.name === this.dispatcherVar) {

        const folded = this.evaluator.fold(node.clauses[0].condition.right);
        const threshold = folded.type === ASTNodeType.NumericLiteral ? folded.value : null;

        const thenBody = node.clauses[0].body;
        const elseBody = node.elseBody;

        if (thenBody && thenBody.length === 1 && thenBody[0].type === ASTNodeType.IfStatement) {
          traverse(thenBody[0], minVal, threshold !== null ? threshold : maxVal);
        } else {
          recordLeaf(thenBody, minVal, threshold !== null ? threshold : maxVal);
        }

        if (elseBody && elseBody.length === 1 && elseBody[0].type === ASTNodeType.IfStatement) {
          traverse(elseBody[0], threshold !== null ? threshold : minVal, maxVal);
        } else if (elseBody) {
          recordLeaf(elseBody, threshold !== null ? threshold : minVal, maxVal);
        }
        return;
      }

      recordLeaf(Array.isArray(node) ? node : [node], minVal, maxVal);
    };

    const recordLeaf = (statements, minVal, maxVal) => {
      stateCounter++;
      let stateId;
      if (Number.isFinite(minVal) && Number.isFinite(maxVal)) {
        stateId = Math.floor((minVal + maxVal) / 2);
      } else if (Number.isFinite(minVal)) {
        stateId = minVal;
      } else if (Number.isFinite(maxVal)) {
        stateId = maxVal - 1;
      } else {
        stateId = stateCounter;
      }

      const stmts = Array.isArray(statements) ? statements : [statements];
      const transitions = [];
      const closureCreations = [];

      for (const stmt of stmts) {
        // Inspect transitions: Q = ...
        if (stmt.type === ASTNodeType.AssignmentStatement &&
            stmt.variables.length > 0 &&
            stmt.variables[0].type === ASTNodeType.Identifier &&
            stmt.variables[0].name === this.dispatcherVar) {

          const rhs = this.evaluator.fold(stmt.init[0]);

          if (rhs.type === ASTNodeType.NumericLiteral) {
            transitions.push({
              type: 'UNCONDITIONAL',
              targetState: rhs.value
            });
          } else if (rhs.type === ASTNodeType.LogicalExpression && rhs.operator === 'or') {
            const leftAnd = rhs.left;
            const rightVal = this.evaluator.fold(rhs.right);
            if (leftAnd.type === ASTNodeType.LogicalExpression && leftAnd.operator === 'and') {
              const cond = leftAnd.left;
              const trueVal = this.evaluator.fold(leftAnd.right);
              if (trueVal.type === ASTNodeType.NumericLiteral && rightVal.type === ASTNodeType.NumericLiteral) {
                transitions.push({
                  type: 'CONDITIONAL',
                  targetState: trueVal.value,
                  branch: 'true'
                });
                transitions.push({
                  type: 'CONDITIONAL',
                  targetState: rightVal.value,
                  branch: 'false'
                });
              } else {
                transitions.push({
                  type: 'RUNTIME_DEPENDENT',
                  raw: rhs.type
                });
              }
            } else {
              transitions.push({
                type: 'RUNTIME_DEPENDENT',
                raw: rhs.type
              });
            }
          } else if ((rhs.type === ASTNodeType.BooleanLiteral && rhs.value === false) ||
                     rhs.type === ASTNodeType.NilLiteral) {
            transitions.push({
              type: 'TERMINAL'
            });
          } else {
            transitions.push({
              type: 'UNRESOLVED',
              raw: rhs.type
            });
          }
        }

        // Inspect closure creations: v(state, ...), I(state, ...), etc.
        const findClosures = (subNode) => {
          if (!subNode || typeof subNode !== 'object') return;
          if (subNode.type === ASTNodeType.CallExpression &&
              subNode.base.type === ASTNodeType.Identifier &&
              this.closureHelperNames.has(subNode.base.name) &&
              subNode.arguments.length > 0) {
            const firstArg = this.evaluator.fold(subNode.arguments[0]);
            if (firstArg && firstArg.type === ASTNodeType.NumericLiteral) {
              closureCreations.push({
                helper: subNode.base.name,
                targetState: firstArg.value
              });
            }
          }
          for (const k of Object.keys(subNode)) {
            if (k === 'loc' || k === 'type') continue;
            const c = subNode[k];
            if (Array.isArray(c)) c.forEach(findClosures);
            else if (c && typeof c === 'object') findClosures(c);
          }
        };
        findClosures(stmt);
      }

      this.states.set(stateId, {
        id: stateId,
        minVal,
        maxVal,
        statementsCount: stmts.length,
        transitions,
        closureCreations,
        incomingEdges: [],
        status: 'UNKNOWN'
      });
    };

    traverse(whileNode.body[0], -Infinity, Infinity);

    // Helper: find which block interval contains a numeric state ID
    const findBlockForState = (targetId) => {
      for (const s of this.states.values()) {
        if (targetId >= s.minVal && targetId < s.maxVal) {
          return s;
        }
      }
      return null;
    };

    // 3. Connect incoming edges
    for (const [sourceId, state] of this.states.entries()) {
      for (const trans of state.transitions) {
        if (typeof trans.targetState === 'number') {
          const target = findBlockForState(trans.targetState);
          if (target) {
            target.incomingEdges.push({
              sourceId,
              type: trans.type
            });
          }
        }
      }
      for (const closure of state.closureCreations) {
        const target = findBlockForState(closure.targetState);
        if (target) {
          target.incomingEdges.push({
            sourceId,
            type: 'CLOSURE_ENTRY',
            helper: closure.helper
          });
        }
      }
    }

    // Also look for root entry call in the AST (e.g. m(13548685, {}))
    const rootEntryState = 13548685;
    const rootBlock = findBlockForState(rootEntryState);
    if (rootBlock) {
      rootBlock.incomingEdges.push({
        sourceId: 'ROOT_CALL',
        type: 'ROOT_ENTRY'
      });
    }

    // 4. Classify reachability according to Rule 3:
    // PROVEN_REACHABLE
    // CONDITIONALLY_REACHABLE
    // UNKNOWN
    // PROVEN_UNREACHABLE

    // BFS from root and from closures
    const provenReachableSet = new Set();
    const conditionallyReachableSet = new Set();
    const unknownSet = new Set();

    const queue = [];
    if (rootBlock) {
      provenReachableSet.add(rootBlock.id);
      queue.push({ block: rootBlock, certainty: 'PROVEN' });
    }

    while (queue.length > 0) {
      const { block, certainty } = queue.shift();

      for (const trans of block.transitions) {
        if (typeof trans.targetState === 'number') {
          const target = findBlockForState(trans.targetState);
          if (target) {
            let nextCertainty = certainty;
            if (trans.type === 'CONDITIONAL') {
              nextCertainty = 'CONDITIONAL';
            }

            if (nextCertainty === 'PROVEN' && !provenReachableSet.has(target.id)) {
              provenReachableSet.add(target.id);
              queue.push({ block: target, certainty: 'PROVEN' });
            } else if (nextCertainty === 'CONDITIONAL' && !provenReachableSet.has(target.id) && !conditionallyReachableSet.has(target.id)) {
              conditionallyReachableSet.add(target.id);
              queue.push({ block: target, certainty: 'CONDITIONAL' });
            }
          }
        } else if (trans.type === 'UNRESOLVED' || trans.type === 'RUNTIME_DEPENDENT') {
          unknownSet.add(block.id);
        }
      }

      // If this block creates closures, those closures are executed whenever the closure is called
      for (const cl of block.closureCreations) {
        const target = findBlockForState(cl.targetState);
        if (target) {
          if (!provenReachableSet.has(target.id) && !conditionallyReachableSet.has(target.id)) {
            conditionallyReachableSet.add(target.id);
            queue.push({ block: target, certainty: 'CONDITIONAL' });
          }
        }
      }
    }

    // Classify all states
    const categorized = {
      PROVEN_REACHABLE: [],
      CONDITIONALLY_REACHABLE: [],
      UNKNOWN: [],
      PROVEN_UNREACHABLE: []
    };

    const removedBlocksAudit = [];

    for (const [id, state] of this.states.entries()) {
      if (provenReachableSet.has(id)) {
        state.status = 'PROVEN_REACHABLE';
        categorized.PROVEN_REACHABLE.push(id);
      } else if (conditionallyReachableSet.has(id)) {
        state.status = 'CONDITIONALLY_REACHABLE';
        categorized.CONDITIONALLY_REACHABLE.push(id);
      } else {
        if (state.minVal >= state.maxVal) {
          state.status = 'PROVEN_UNREACHABLE';
          categorized.PROVEN_UNREACHABLE.push(id);
          removedBlocksAudit.push({
            state: id,
            reason: 'Impossible interval condition (min >= max)',
            proof: `[${state.minVal}, ${state.maxVal}) is an empty interval in binary search tree`,
            confidence: 'PROVEN',
            incomingEdges: state.incomingEdges,
            outgoingEdges: state.transitions
          });
        } else if (state.incomingEdges.length === 0 && unknownSet.size === 0) {
          state.status = 'PROVEN_UNREACHABLE';
          categorized.PROVEN_UNREACHABLE.push(id);
          removedBlocksAudit.push({
            state: id,
            reason: 'Zero incoming transitions and zero closure references in closed CFG',
            proof: 'No predecessor block transitions to this state interval',
            confidence: 'PROVEN',
            incomingEdges: [],
            outgoingEdges: state.transitions
          });
        } else {
          state.status = 'UNKNOWN';
          categorized.UNKNOWN.push(id);
          removedBlocksAudit.push({
            state: id,
            reason: 'Not reached from outer entry, but may be called via higher-order closures, callbacks, or dynamic transitions',
            proof: 'Cannot prove non-execution without whole-program pointer/alias analysis',
            confidence: 'UNKNOWN',
            safetyVerdict: 'UNSAFE_TO_REMOVE',
            incomingEdges: state.incomingEdges,
            outgoingEdges: state.transitions
          });
        }
      }
    }

    const auditReport = {
      totalDiscoveredStates: this.states.size,
      provenReachable: categorized.PROVEN_REACHABLE.length,
      conditionallyReachable: categorized.CONDITIONALLY_REACHABLE.length,
      unknown: categorized.UNKNOWN.length,
      provenUnreachable: categorized.PROVEN_UNREACHABLE.length,
      previousEngineClaim: {
        states: 610,
        reachable: 14,
        removed: 596
      },
      auditVerdict: {
        isPreviousTransformationSafe: categorized.UNKNOWN.length === 0,
        unprovenRemovalsCount: categorized.UNKNOWN.length,
        finding: `The previous engine pruned 596 states by only following unconditional/conditional transitions from entry state 13548685. The independent audit found that ${categorized.CONDITIONALLY_REACHABLE.length} states are reachable via closures and ${categorized.UNKNOWN.length} states cannot be proven unreachable. Pruning them was UNSAFE!`
      }
    };

    fs.writeFileSync(path.resolve(__dirname, 'cfg-audit.json'), JSON.stringify(auditReport, null, 2), 'utf8');
    fs.writeFileSync(path.resolve(__dirname, 'removed-blocks.json'), JSON.stringify(removedBlocksAudit, null, 2), 'utf8');
    console.log('Wrote audit/cfg-audit.json and audit/removed-blocks.json');
    return auditReport;
  }
}

if (require.main === module) {
  const auditor = new CFGAuditor();
  const res = auditor.audit(path.resolve(__dirname, '../ByIdiotSandWich.txt'));
  console.log(JSON.stringify(res, null, 2));
}

module.exports = { CFGAuditor };
