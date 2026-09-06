const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../test-framework');
const { recover } = require('../../packages/core/src');
const { parse } = require('../../packages/core/src/parser');

function runMetamorphicTests() {
  describe('Rule 12: Metamorphic Testing Suite', () => {
    const fixtures = [
      '07_metamorphic_closures.lua',
      '08_metamorphic_dispatch_control.lua',
      '09_metamorphic_tables_meta.lua',
      '10_metamorphic_varargs_multireturn.lua',
      '11_metamorphic_boolean_shortcircuit.lua'
    ];

    const fixturesDir = path.resolve(__dirname, '../../corpus/fixtures');

    for (const fixture of fixtures) {
      test(`verifies metamorphic invariant for ${fixture}`, () => {
        const filePath = path.join(fixturesDir, fixture);
        const source = fs.readFileSync(filePath, 'utf8');

        // Pass 1: Recover
        const res1 = recover(source, { filename: fixture });
        expect(res1.code.length).toBeGreaterThan(0);

        // Verification: parse back
        const ast1 = parse(res1.code);
        expect(ast1.type).toBe('Chunk');

        // Pass 2: Idempotence
        const res2 = recover(res1.code, { filename: `${fixture}.second` });
        const ast2 = parse(res2.code);
        expect(ast2.type).toBe('Chunk');

        // Verify structural stability (byte delta between pass 1 and pass 2 <= 5 bytes)
        const delta = Math.abs(Buffer.byteLength(res2.code, 'utf8') - Buffer.byteLength(res1.code, 'utf8'));
        expect(delta).toBeLessThanOrEqual(5);
      });
    }
  });
}

module.exports = { runMetamorphicTests };
if (require.main === module) {
  runMetamorphicTests();
  const { printSummary } = require('../test-framework');
  printSummary();
}
