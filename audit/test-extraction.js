const fs = require('fs');
const path = require('path');
const { parse } = require('../packages/core/src/parser');
const { generate } = require('../packages/core/src/generator');
const { DispatcherAnalyzer } = require('../packages/core/src/cfg/dispatcher');
const { ResidualDispatcherCompressor } = require('../packages/core/src/transforms/residual-dispatcher');

function testExtractionAndRoundTrip() {
  const src = fs.readFileSync(path.resolve(__dirname, '../ByIdiotSandWich.txt'), 'utf8');
  const ast = parse(src);

  const da = new DispatcherAnalyzer();
  const disps = da.findDispatchers(ast);
  const cfg = da.buildCFG(disps[0].stateVar, disps[0].rootIf, 13548685);

  const exclusiveProof = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'exclusive-state-proof.json'), 'utf8'));

  const compressor = new ResidualDispatcherCompressor();
  const extractable = compressor.findExtractableStates(cfg, exclusiveProof, new Set());

  console.log('Safe extraction candidates:', extractable.size);

  const res = compressor.compressDispatcher(disps[0].rootIf, disps[0].stateVar, extractable, cfg);
  console.log('Physical states before:', res.stats.physicalStatesBefore);
  console.log('Physically extracted states:', res.stats.physicallyExtractedStates);
  console.log('Physical states after:', res.stats.physicalStatesAfter);
  console.log('Branches pruned:', res.stats.branchesPruned);

  // Replace rootIf
  disps[0].whileNode.body = [res.rootIf];

  // Test Lua generation
  const luaCode = generate(ast);
  console.log('Generated code bytes:', luaCode.length);

  // Test round-trip parse
  const reParsed = parse(luaCode);
  console.log('Round-trip parse success:', reParsed && reParsed.type === 'Chunk');
}

testExtractionAndRoundTrip();
