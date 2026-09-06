const fs = require('fs');
const path = require('path');
const { parse } = require('../packages/core/src/parser');
const { StructuralFingerprint } = require('../packages/core/src/adapters/structural-fingerprint');
const { StructuralClusterer } = require('../packages/core/src/adapters/clustering');

function generateFingerprintComparison() {
  const fingerprinter = new StructuralFingerprint();
  const clusterer = new StructuralClusterer();

  const knownFixtures = [];

  // 1. ByIdiotSandWich.txt
  const goldenPath = path.resolve(__dirname, '../ByIdiotSandWich.txt');
  if (fs.existsSync(goldenPath)) {
    const src = fs.readFileSync(goldenPath, 'utf8');
    const ast = parse(src);
    const fp = fingerprinter.extract(ast, src);
    const family = clusterer.classify(fp);
    knownFixtures.push({
      fixtureId: 'golden_fixture_byidiotsandwich',
      file: 'ByIdiotSandWich.txt',
      family,
      fingerprint: fp
    });
  }

  // 2. ByMethion.txt (in Downloads)
  const methionPath = 'c:/Users/ksjz1/Downloads/ByMethion.txt';
  if (fs.existsSync(methionPath)) {
    const src = fs.readFileSync(methionPath, 'utf8');
    const ast = parse(src);
    const fp = fingerprinter.extract(ast, src);
    const family = clusterer.classify(fp);
    knownFixtures.push({
      fixtureId: 'real_sample_bymethion',
      file: 'ByMethion.txt',
      family,
      fingerprint: fp
    });
  }

  const comparisonDoc = {
    analyzedFixturesCount: knownFixtures.length,
    gateAPairedFixturesAwaiting: 10,
    structuralFamiliesIdentified: Array.from(new Set(knownFixtures.map(k => k.family))),
    fixtures: knownFixtures,
    runtimeObservations: {
      commonRuntimeFeatures: [
        "Self-executing IIFE wrapper: (function(...) ... end)(...)",
        "Binary Search Tree nested if-else conditional dispatcher topology",
        "Environment unpacking / runtime alias unpacking via unpack/f()",
        "Closure factory helper functions (m, o, R, p, etc.) taking state machine descriptors",
        "State machine execution driven by while-loop over state variable (e or Q)"
      ],
      variableRuntimeFeatures: [
        "String pool decoding mechanism (Alphabet substitution table with offset arithmetic vs. direct string array)",
        "Rotation ranges count (multi-range byte rotation vs. no rotation)",
        "Binary Search Tree nesting depth (scales with state count, e.g. depth 8 for 72 states, depth 11 for 610 states)",
        "Closure constructor density (proportional to source program function count)"
      ],
      sourceDependentFeatures: [
        "Physical state count directly depends on statement complexity and branch branching factors in original source",
        "Number and arity of closure factory helpers directly map to functions in the original source program",
        "Terminal state transition patterns (return count and indirect dispatch exits)"
      ],
      possibleSeedDependentFeatures: [
        "Initial state IDs and numeric constants generated during binary search branching",
        "Alphabet permutation order and accessor function arithmetic offset (e.g. 53741)",
        "Variable and argument renaming in closure factory helpers and dispatcher wrappers"
      ]
    }
  };

  const outPath = path.resolve(__dirname, '../audit/gate-a-fingerprint-comparison.json');
  fs.writeFileSync(outPath, JSON.stringify(comparisonDoc, null, 2), 'utf8');
  console.log('Emitted audit/gate-a-fingerprint-comparison.json.');
}

if (require.main === module) {
  generateFingerprintComparison();
}

module.exports = { generateFingerprintComparison };
