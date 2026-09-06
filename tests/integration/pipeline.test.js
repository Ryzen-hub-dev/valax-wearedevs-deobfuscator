const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../test-framework');
const { recover } = require('../../packages/core/src');
const { parse } = require('../../packages/core/src/parser');

function runPipelineTests() {
  describe('Phase 15: Integration Tests (Pipeline on Progressive Fixtures)', () => {
    const fixturesDir = path.resolve(__dirname, '../../corpus/fixtures');
    const fixtures = [
      '01_hello.lua',
      '02_arithmetic.lua',
      '03_functions.lua',
      '04_control_flow.lua',
      '05_tables_closures.lua',
      '06_obfuscated_snippet.lua'
    ];

    for (const file of fixtures) {
      test(`processes fixture ${file}`, () => {
        const filePath = path.join(fixturesDir, file);
        const source = fs.readFileSync(filePath, 'utf8');

        const result = recover(source, { filename: file, stage: 'L5' });

        expect(result).toBeTruthy();
        expect(result.code.length).toBeGreaterThan(0);
        expect(result.report).toBeTruthy();
        expect(result.report.inputBytes).toBeGreaterThan(0);
        expect(result.report.outputBytes).toBeGreaterThan(0);

        // Verify generated code parses back cleanly into an AST
        const recheckAst = parse(result.code);
        expect(recheckAst.type).toBe('Chunk');
      });
    }

    test('recovers obfuscated snippet (06_obfuscated_snippet.lua)', () => {
      const filePath = path.join(fixturesDir, '06_obfuscated_snippet.lua');
      const source = fs.readFileSync(filePath, 'utf8');
      const result = recover(source, { filename: '06_obfuscated_snippet.lua' });

      // Should simplify 514856 + -514855 to 1
      expect(result.report.constantsFolded).toBeGreaterThan(0);
      // Generated code should contain "Hello" or clean indexing
      expect(result.code).toContain('local x = 1');
    });
  });
}

module.exports = { runPipelineTests };
if (require.main === module) {
  runPipelineTests();
  const { printSummary } = require('../test-framework');
  printSummary();
}
