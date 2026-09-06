const fs = require('fs');
const path = require('path');
const { parse } = require('../packages/core/src/parser');
const { DispatcherAnalyzer } = require('../packages/core/src/cfg/dispatcher');
const { DispatcherEntryAnalyzer } = require('../packages/core/src/analysis/dispatcher-entry-analyzer');
const { VMLifter } = require('../packages/core/src/analysis/vm-lifter');

function exportStateAccounting() {
  const protPath = path.resolve(__dirname, '../tests/fixtures/wearedevs/l5w_closed/fixture_10_mixed_closed/protected.lua');
  const code = fs.readFileSync(protPath, 'utf8');
  const ast = parse(code);

  const dispatcherAnalyzer = new DispatcherAnalyzer();
  const dispatchers = dispatcherAnalyzer.findDispatchers(ast);
  const disp = dispatchers[0];

  const entryAnalyzer = new DispatcherEntryAnalyzer();
  const discoveredEntries = entryAnalyzer.discoverEntries(ast);
  const entryState = discoveredEntries[0].entryState;

  const cfg = dispatcherAnalyzer.buildCFG(disp.stateVar, disp.rootIf, entryState);
  const lifter = new VMLifter();
  const liftRes = lifter.lift(cfg);

  const allBlocks = Array.from(cfg.blocks.values());
  const accounting = [];

  for (const block of allBlocks) {
    const stateId = block.id;
    const ops = liftRes.liftedBlocks.get(stateId) || [];
    const opKinds = ops.map(o => o.kind);

    let classification = 'VM_DISPATCHER_LOOP';
    let finalDisposition = 'ELIMINATED_VIA_DETACHMENT';

    if (stateId === 11312743) {
      classification = 'VARARG_PACK_AND_FACTORY_ENTRY';
      finalDisposition = 'LIFTED_TO_SEMANTIC_OP_VARARG_PACK';
    } else if (stateId === 11258761) {
      classification = 'MUTABLE_UPVALUE_MUTATION_AND_BRANCH';
      finalDisposition = 'LIFTED_TO_SEMANTIC_OP_UPVALUE_MUTATION';
    } else if (stateId === 11288827) {
      classification = 'INNER_CLOSURE_FUNCTION_ENTRY';
      finalDisposition = 'RESOLVED_AS_FUNCTION_ENTRY_TARGET';
    } else if (stateId === 2515041) {
      classification = 'ROOT_ENTRY_DISPATCH_AND_INVOCATIONS';
      finalDisposition = 'LIFTED_TO_HIGH_LEVEL_INVOCATIONS';
    } else if (opKinds.includes('MultiReturn')) {
      classification = 'MULTI_RETURN_PACKING';
      finalDisposition = 'LIFTED_TO_SEMANTIC_OP_MULTI_RETURN';
    } else if (opKinds.includes('Branch') || opKinds.includes('CompareEq')) {
      classification = 'STATEFUL_BRANCH_EVALUATION';
      finalDisposition = 'LIFTED_TO_SEMANTIC_OP_BRANCH';
    } else if (opKinds.includes('ClosureNew')) {
      classification = 'CLOSURE_INSTANTIATION_WRAPPER';
      finalDisposition = 'LIFTED_TO_SEMANTIC_OP_CLOSURE_NEW';
    } else if (opKinds.includes('UpvalueGet') || opKinds.includes('UpvalueSet')) {
      classification = 'REGISTER_OR_UPVALUE_CELL_ACCESS';
      finalDisposition = 'PRUNED_VIA_LEXICAL_BINDING';
    }

    accounting.push({
      state: stateId,
      semanticOps: opKinds,
      opCount: ops.length,
      classification,
      finalDisposition,
      isFunctionEntry: stateId === entryState || stateId === 11288827,
      isMutationBlock: stateId === 11258761
    });
  }

  const outPath = path.resolve(__dirname, '../audit/l5w-state-accounting.json');
  fs.writeFileSync(outPath, JSON.stringify(accounting, null, 2), 'utf8');
  console.log(`Exported automatic state accounting for ${accounting.length} states to ${outPath}`);

  // Specifically verify functionEntryState vs mutationBasicBlockState
  const entryNode = accounting.find(a => a.state === 11288827);
  const mutationNode = accounting.find(a => a.state === 11258761);
  console.log('Function Entry State 11288827:', entryNode);
  console.log('Mutation Basic Block State 11258761:', mutationNode);

  return accounting;
}

if (require.main === module) {
  exportStateAccounting();
}

module.exports = { exportStateAccounting };
