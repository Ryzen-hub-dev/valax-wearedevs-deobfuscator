const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../test-framework');
const { recover } = require('../../packages/core/src');
const { parse } = require('../../packages/core/src/parser');

function runRegressionTests() {
  describe('Primary Real-World Regression: ByIdiotSandWich.txt (WeAreDevs v1.0.0)', () => {
    const fixturePath = path.resolve(__dirname, '../../ByIdiotSandWich.txt');

    test('verifies primary fixture file exists and has content', () => {
      expect(fs.existsSync(fixturePath)).toBe(true);
      const stats = fs.statSync(fixturePath);
      expect(stats.size).toBeGreaterThan(200000);
    });

    test('analyzes and deobfuscates ByIdiotSandWich.txt with proven invariants', () => {
      const source = fs.readFileSync(fixturePath, 'utf8');
      const result = recover(source, { filename: 'ByIdiotSandWich.txt', stage: 'L5' });

      // 1. Format Detection
      expect(result.report.detectedFormat).toBe('WeAreDevs');
      expect(result.report.version).toBe('v1.0.0');

      // 2. Numeric simplifications (assert real folded expression volume)
      expect(result.report.constantsFolded).toBeGreaterThan(5000);

      // 3. String table recovery: 1139/1139
      expect(result.report.stringsFound).toBe(1139);
      expect(result.report.stringsRecovered).toBe(1139);

      // 4. Runtime Aliases: at least 10 proven aliases recovered
      expect(result.report.aliasesRecovered).toBeGreaterThanOrEqual(10);

      // 5. Dispatcher & CFG Statistics: 610 states, 0 unproven blocks removed
      expect(result.report.dispatcher).toBeTruthy();
      expect(result.report.dispatcher.dispatcherCandidate).toBe('Q');
      expect(result.report.dispatcher.states).toBe(610);
      expect(result.report.blocksRemoved).toBe(0); // Never remove unproven blocks!

      // 6. Recovery Level: verified genuine L4 (residual dispatcher states < 610)
      expect(result.report.recoveryLevel).toBe('L4');
      expect(result.report.closureAnalysis).toBeTruthy();
      expect(result.report.closureAnalysis.structuredFunctions).toBeGreaterThan(50);
      expect(result.report.closureAnalysis.knownEntryStates).toBeGreaterThan(50);
      expect(result.report.closureAnalysis.remainingDispatcherStates).toBeLessThan(610);
      expect([425, 427]).toContain(result.report.closureAnalysis.remainingDispatcherStates);

      // 7. Rigorous Parser Round-Trip Assertion (Rejects invalid Lua syntax)
      expect(result.report.roundtripVerified).toBe(true);
      const reParsedAst = parse(result.code);
      expect(reParsedAst.type).toBe('Chunk');

      // Write result output for inspection
      const outPath = path.resolve(__dirname, '../../ByIdiotSandWich.recovered.lua');
      fs.writeFileSync(outPath, result.code, 'utf8');
      const reportPath = path.resolve(__dirname, '../../ByIdiotSandWich.report.json');
      fs.writeFileSync(reportPath, JSON.stringify(result.report, null, 2), 'utf8');
    });
  });
}

module.exports = { runRegressionTests };
if (require.main === module) {
  runRegressionTests();
  const { printSummary } = require('../test-framework');
  printSummary();
}
