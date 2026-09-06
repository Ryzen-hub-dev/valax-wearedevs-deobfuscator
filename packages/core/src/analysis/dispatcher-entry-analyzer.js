const { ASTNodeType } = require('../ast/nodes');
const { ConstantEvaluator } = require('../evaluator/constant-evaluator');
const { CLOSURE_HELPERS, detectClosureHelpers } = require('./closure-analyzer');

class DispatcherEntryAnalyzer {
  constructor() {
    this.evaluator = new ConstantEvaluator();
  }

  /**
   * Discovers all entry states to the shared dispatcher across the AST.
   * @param {object} astChunk
   * @param {Array<object>} rawConstructors
   * @param {string} [stateVar]
   * @returns {Array<object>} Entry states with evidence
   */
  discoverEntries(astChunk, rawConstructors = [], stateVar = null) {
    const entries = [];
    const seenStates = new Map(); // state -> entry object
    const detectedHelpers = detectClosureHelpers(astChunk);

    if (!stateVar) {
      const findStateVar = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === ASTNodeType.WhileStatement && node.condition && node.condition.type === ASTNodeType.Identifier) {
          if (node.body.length > 0 && node.body[0].type === ASTNodeType.IfStatement) {
            stateVar = node.condition.name;
            return;
          }
        }
        for (const k of Object.keys(node)) {
          if (stateVar) return;
          if (k === 'loc' || k === 'type') continue;
          const c = node[k];
          if (Array.isArray(c)) c.forEach(findStateVar);
          else if (c && typeof c === 'object') findStateVar(c);
        }
      };
      findStateVar(astChunk);
    }

    // 1. Dynamic root call site discovery: look for root invocation helper(state, ...)
    let rootEntryState = null;
    const findRootEntry = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === ASTNodeType.CallExpression) {
        if (node.base.type === ASTNodeType.Identifier && detectedHelpers.has(node.base.name)) {
          if (node.arguments.length > 0) {
            const folded = this.evaluator.fold(node.arguments[0]);
            if (folded.type === ASTNodeType.NumericLiteral) {
              rootEntryState = folded.value;
            }
          }
        }
      }
      for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'type') continue;
        const child = node[k];
        if (Array.isArray(child)) child.forEach(findRootEntry);
        else if (child && typeof child === 'object') findRootEntry(child);
      }
    };
    findRootEntry(astChunk);

    if (rootEntryState !== null) {
      const rootEntry = {
        entryState: rootEntryState,
        functionContext: 'root_entry',
        evidenceType: 'root_invocation_call',
        confidence: 'PROVEN',
        sourceLocation: 'script root return invocation'
      };
      entries.push(rootEntry);
      seenStates.set(rootEntryState, rootEntry);
    }

    // 2. Closure constructors
    for (const c of rawConstructors) {
      if (c.entryState !== null) {
        if (!seenStates.has(c.entryState)) {
          const entry = {
            entryState: c.entryState,
            functionContext: c.constructorId,
            helper: c.helper,
            evidenceType: 'closure_constructor_argument',
            confidence: c.entryStateConfidence || 'PROVEN',
            sourceLocation: c.sourceLocation
          };
          entries.push(entry);
          seenStates.set(c.entryState, entry);
        }
      }
    }

    // 3. Scan for any indirect or table-driven entry assignments (e.g. stateVar = <const>)
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;

      if (node.type === ASTNodeType.AssignmentStatement &&
          node.variables[0] &&
          node.variables[0].type === ASTNodeType.Identifier &&
          (node.variables[0].name === stateVar || node.variables[0].name === 'Q')) {
        const rhs = this.evaluator.fold(node.init[0]);
        if (rhs.type === ASTNodeType.NumericLiteral) {
          if (!seenStates.has(rhs.value)) {
            const entry = {
              entryState: rhs.value,
              functionContext: 'transition_target',
              evidenceType: 'state_variable_assignment',
              confidence: 'CONDITIONAL',
              sourceLocation: node.loc ? `line ${node.loc.start.line}` : 'internal'
            };
            entries.push(entry);
            seenStates.set(rhs.value, entry);
          }
        }
      }

      for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'type') continue;
        const child = node[k];
        if (Array.isArray(child)) child.forEach(visit);
        else if (child && typeof child === 'object') visit(child);
      }
    };

    visit(astChunk);
    return entries;
  }
}

module.exports = { DispatcherEntryAnalyzer };
