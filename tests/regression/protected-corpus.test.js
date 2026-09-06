const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../test-framework');
const { parse } = require('../../packages/core/src/parser');
const { RecoveryPipeline } = require('../../packages/core/src/transforms/pipeline');
const { StructuralFingerprint } = require('../../packages/core/src/adapters/structural-fingerprint');
const { StructuralClusterer } = require('../../packages/core/src/adapters/clustering');

function runProtectedCorpusTests() {
  describe('Rule 11 & 18: Protected Corpus Validation Suite', () => {
    const protectedDir = path.resolve(__dirname, '../../protected-corpus');
    if (!fs.existsSync(protectedDir)) {
      throw new Error('protected-corpus directory not found.');
    }

    const fixtures = fs.readdirSync(protectedDir).filter(f => fs.statSync(path.join(protectedDir, f)).isDirectory());

    test('1. Protected corpus contains at least 2 verified real protected fixtures', () => {
      expect(fixtures.length).toBeGreaterThanOrEqual(2);
    });

    for (const fId of fixtures) {
      const fPath = path.join(protectedDir, fId);
      const protFile = path.join(fPath, 'protected.lua');
      const metaFile = path.join(fPath, 'metadata.json');
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));

      test(`2. Protected fixture [${fId}] matches structural fingerprint and family`, () => {
        const protCode = fs.readFileSync(protFile, 'utf8');
        const ast = parse(protCode);
        const fingerprinter = new StructuralFingerprint();
        const fp = fingerprinter.extract(ast, protCode);

        const clusterer = new StructuralClusterer();
        const family = clusterer.classify(fp);

        expect(fp.dispatcherTopology).toBe('binary_search_tree');
        expect(fp.stateCount).toBeGreaterThan(0);
        expect(family).toBe(meta.structuralFamily);
      });

      test(`3. Protected fixture [${fId}] recovers to L4 baseline without silent corruption`, () => {
        const protCode = fs.readFileSync(protFile, 'utf8');
        const pipeline = new RecoveryPipeline();
        const res = pipeline.run(protCode);

        expect(res.report.recoveryLevel).toBe('L4');
        expect(res.report.roundtripVerified).toBe(true);
        expect(res.report.stringsRecovered).toBe(res.report.stringsFound);
        expect(res.code.length).toBeGreaterThan(0);
      });
    }
  });
}

module.exports = { runProtectedCorpusTests };

if (require.main === module) {
  runProtectedCorpusTests();
  const { printSummary } = require('../test-framework');
  printSummary();
}
