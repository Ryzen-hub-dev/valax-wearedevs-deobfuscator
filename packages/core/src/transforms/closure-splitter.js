const { ASTNodeType, functionExpression, identifier, ifStatement, whileStatement, returnStatement } = require('../ast/nodes');
const { transform } = require('../ast/visitor');
const { ClosureConstructorAnalyzer } = require('../analysis/closure-analyzer');
const { DispatcherEntryAnalyzer } = require('../analysis/dispatcher-entry-analyzer');
const { FunctionContext } = require('../analysis/function-context');
const { PointsToAnalyzer } = require('../analysis/points-to');
const { MultiEntryCFGAnalyzer } = require('../cfg/multi-entry-cfg');
const { FunctionIR, ProgramIR, StructuredRegion, UnstructuredRegion } = require('../ir/function-ir');
const { EdgeType } = require('../cfg/edge');
const { ResidualDispatcherCompressor } = require('./residual-dispatcher');

class ClosureSplitterTransform {
  constructor(options = {}) {
    this.closureAnalyzer = new ClosureConstructorAnalyzer();
    this.entryAnalyzer = new DispatcherEntryAnalyzer();
    this.stats = {
      closureConstructors: 0,
      functionContexts: 0,
      knownEntryStates: 0,
      exclusiveStates: 0,
      sharedStates: 0,
      unresolvedStates: 0,
      directCalls: 0,
      indirectCalls: 0,
      unknownCalls: 0,
      structuredFunctions: 0,
      partiallyStructuredFunctions: 0,
      unresolvedFunctions: 0,
      structuredStates: 0,
      physicalStatesBefore: 0,
      physicallyExtractedStates: 0,
      remainingDispatcherStates: 0,
      branchesPruned: 0
    };
    this.functionContexts = [];
    this.pointsToResults = null;
    this.cfgAnalysisResults = null;
  }

  /**
   * Run whole-program closure separation and multi-entry state restructuring.
   * @param {object} astChunk
   * @param {ControlFlowGraph} sharedCFG
   * @param {object} [disp] Dispatcher metadata { whileNode, rootIf, stateVar }
   */
  run(astChunk, sharedCFG, disp = null) {
    // 1. Discover closure constructors (Phase 1)
    const rawConstructors = this.closureAnalyzer.analyze(astChunk);
    this.stats.closureConstructors = rawConstructors.length;

    // 2. Discover dispatcher entry states (Phase 5)
    const discoveredEntries = this.entryAnalyzer.discoverEntries(astChunk, rawConstructors);
    this.stats.knownEntryStates = discoveredEntries.length;

    // 3. Construct FunctionContexts (Phase 2)
    const contexts = [];
    const contextByState = new Map();

    for (let i = 0; i < discoveredEntries.length; i++) {
      const entry = discoveredEntries[i];
      const matchConstructor = rawConstructors.find(c => c.entryState === entry.entryState);

      const ctx = new FunctionContext({
        id: `func_${i + 1}`,
        name: entry.functionContext === 'root_entry' ? 'root_entry' : `func_state_${entry.entryState}`,
        constructorId: matchConstructor ? matchConstructor.constructorId : `entry_${i + 1}`,
        helper: matchConstructor ? matchConstructor.helper : null,
        entryState: entry.entryState,
        parameters: matchConstructor ? matchConstructor.parameters.map(p => identifier(p)) : [],
        paramCount: matchConstructor ? matchConstructor.paramCount : 0,
        vararg: matchConstructor ? matchConstructor.vararg : false,
        capturedUpvalues: matchConstructor ? matchConstructor.capturedValues : []
      });

      contexts.push(ctx);
      contextByState.set(entry.entryState, ctx);
    }
    this.functionContexts = contexts;
    this.stats.functionContexts = contexts.length;

    // 4. Points-to Analysis (Phase 3)
    const pointsTo = new PointsToAnalyzer(contexts);
    this.pointsToResults = pointsTo.analyze(astChunk, rawConstructors);

    for (const edge of this.pointsToResults.callGraphEdges) {
      if (edge.type === 'direct_call') this.stats.directCalls++;
      else if (edge.type === 'table_contained_function') this.stats.indirectCalls++;
      else this.stats.unknownCalls++;
    }

    // 5. Multi-Entry Context-Sensitive CFG Traversal
    const multiEntryCFG = new MultiEntryCFGAnalyzer(sharedCFG, contexts);
    this.cfgAnalysisResults = multiEntryCFG.analyze();

    // Tally state ownership classification
    const exclusiveProofList = [];
    for (const [stateId, classification] of this.cfgAnalysisResults.stateClassification.entries()) {
      if (classification === 'EXCLUSIVE') {
        this.stats.exclusiveStates++;
        const owners = this.cfgAnalysisResults.stateOwnership.get(stateId);
        exclusiveProofList.push({
          state: stateId,
          exclusiveOwner: owners ? Array.from(owners)[0] : 'unknown',
          status: 'EXCLUSIVE_PROVEN',
          safeToExtract: true
        });
      } else if (classification === 'SHARED') {
        this.stats.sharedStates++;
      } else {
        this.stats.unresolvedStates++;
      }
    }

    // 6. Function region reconstruction
    const reconstructedFunctions = new Map(); // entryState -> FunctionExpression AST

    for (const func of contexts) {
      const reachableList = Array.from(func.reachableStates);
      if (reachableList.length > 0 && reachableList.length <= 40) {
        const structuredStmts = this.reconstructFunctionBody(func, sharedCFG);
        if (structuredStmts && structuredStmts.length > 0) {
          const fnExpr = functionExpression(
            func.parameters,
            func.isVararg,
            structuredStmts
          );
          reconstructedFunctions.set(func.entryState, fnExpr);
          func.structuredRegion = new StructuredRegion('sequence', structuredStmts);
          this.stats.structuredFunctions++;
          this.stats.structuredStates += reachableList.length;
        } else {
          this.stats.unresolvedFunctions++;
        }
      } else {
        this.stats.unresolvedFunctions++;
      }
    }

    this.stats.physicalStatesBefore = sharedCFG.blocks.size;

    // 7. Physical Residual Dispatcher Compression (Phase 16-20)
    if (disp && disp.rootIf) {
      const compressor = new ResidualDispatcherCompressor();
      const extractable = compressor.findExtractableStates(sharedCFG, exclusiveProofList, new Set(reconstructedFunctions.keys()));
      const compRes = compressor.compressDispatcher(disp.rootIf, sharedCFG.dispatcherVar, extractable, sharedCFG);

      disp.whileNode.body = [compRes.rootIf];
      this.stats.physicallyExtractedStates = compRes.stats.physicallyExtractedStates;
      this.stats.remainingDispatcherStates = compRes.stats.physicalStatesAfter;
      this.stats.branchesPruned = compRes.stats.branchesPruned;
    } else {
      this.stats.remainingDispatcherStates = sharedCFG.blocks.size;
    }

    // 8. Rewrite AST: Replace constructor calls for structured functions
    let transformedAst = astChunk;
    if (reconstructedFunctions.size > 0) {
      transformedAst = transform(astChunk, (node) => {
        if (node.type === ASTNodeType.CallExpression &&
            node.base.type === ASTNodeType.Identifier &&
            node.arguments.length >= 1) {
          const firstArg = node.arguments[0];
          if (firstArg && firstArg.type === ASTNodeType.NumericLiteral) {
            if (reconstructedFunctions.has(firstArg.value)) {
              return reconstructedFunctions.get(firstArg.value);
            }
          }
        }
        return undefined;
      });
    }

    return {
      ast: transformedAst,
      stats: this.stats,
      reconstructedFunctionsCount: reconstructedFunctions.size
    };
  }

  /**
   * Reconstruct structured statements for a specific FunctionContext from its CFG.
   * @param {FunctionContext} func
   * @param {ControlFlowGraph} sharedCFG
   */
  reconstructFunctionBody(func, sharedCFG) {
    const entryBlock = sharedCFG.getBlock(func.entryState) ||
                       Array.from(sharedCFG.blocks.values()).find(b => func.entryState >= b.minState && func.entryState < b.maxState);

    if (!entryBlock) return null;

    const visited = new Set();

    const walk = (block) => {
      if (!block || visited.has(block.id)) return [];
      visited.add(block.id);

      const cleanBlockStmts = block.statements.filter(s => {
        if (s.type === ASTNodeType.AssignmentStatement &&
            s.variables.length === 1 &&
            s.variables[0].type === ASTNodeType.Identifier &&
            s.variables[0].name === sharedCFG.dispatcherVar) {
          return false;
        }
        return true;
      });

      const successors = block.successors.filter(e => e.target && func.reachableStates.has(e.target.id));

      if (successors.length === 1 && successors[0].type === EdgeType.UNCONDITIONAL) {
        const nextStmts = walk(successors[0].target);
        return [...cleanBlockStmts, ...nextStmts];
      }

      const trueEdge = successors.find(e => e.type === EdgeType.CONDITIONAL_TRUE);
      const falseEdge = successors.find(e => e.type === EdgeType.CONDITIONAL_FALSE);

      if (trueEdge && falseEdge) {
        const trueBranch = walk(trueEdge.target);
        const falseBranch = walk(falseEdge.target);
        const cond = trueEdge.condition || block.stateTransitions[0]?.condition;

        if (cond) {
          cleanBlockStmts.push(ifStatement(
            [{ condition: cond, body: trueBranch }],
            falseBranch.length > 0 ? falseBranch : null
          ));
          return cleanBlockStmts;
        }
      }

      return cleanBlockStmts;
    };

    return walk(entryBlock);
  }
}

module.exports = { ClosureSplitterTransform };
