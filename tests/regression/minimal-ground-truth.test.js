const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect } = require('../test-framework');
const { recover } = require('../../packages/core/src');
const { parse } = require('../../packages/core/src/parser');

function runMinimalGroundTruthTests() {
  describe('Minimal Ground-Truth Recovery Gate: minimal_print (print("hi"))', () => {
    const fixtureDir = path.resolve(__dirname, '../fixtures/wearedevs/minimal_print');
    const protectedPath = path.join(fixtureDir, 'protected.lua');
    const originalPath = path.join(fixtureDir, 'original.lua');
    const metadataPath = path.join(fixtureDir, 'metadata.json');

    test('1. Minimal ground-truth fixture files exist and are valid', () => {
      expect(fs.existsSync(protectedPath)).toBe(true);
      expect(fs.existsSync(originalPath)).toBe(true);
      expect(fs.existsSync(metadataPath)).toBe(true);

      const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      expect(meta.fixtureType).toBe('PAIRED_GROUND_TRUTH');
      expect(['L5', 'L5-W']).toContain(meta.targetLevel);
    });

    let l5Result = null;

    test('2. Stage L5 deobfuscates protected.lua to high-level print("hi")', () => {
      const source = fs.readFileSync(protectedPath, 'utf8');
      l5Result = recover(source, { stage: 'L5', filename: 'minimal_print.lua' });

      // Invariant 1: Recovery level must be genuine L5-W (Rule 14)
      expect(l5Result.report.recoveryLevel).toBe('L5-W');

      // Invariant 2: High-level output code must be equivalent to print("hi")
      const trimmed = l5Result.code.trim();
      expect(trimmed).toBe('print("hi")');

      // Invariant 3: Output size must be concise (<= 5 lines, target <= 20 lines)
      const lines = trimmed.split('\n').filter(l => l.trim().length > 0);
      expect(lines.length).toBeLessThanOrEqual(5);

      // Invariant 4: AST complexity must be minimal (<= 10 payload AST nodes)
      const reParsedAst = parse(l5Result.code);
      expect(reParsedAst.type).toBe('Chunk');
      expect(reParsedAst.body.length).toBe(1);
      expect(reParsedAst.body[0].type).toBe('CallStatement');
      expect(reParsedAst.body[0].expression.base.name).toBe('print');
      expect(reParsedAst.body[0].expression.arguments[0].value.toString()).toBe('hi');

      // Invariant 5: AST Node Provenance metadata (Rule 2)
      expect(l5Result.ast.provenance).toBeTruthy();
      expect(l5Result.ast.provenance.origin).toBe('STATIC_AND_DYNAMIC');

      // Invariant 6: Exactly 0 residual dispatcher states, 0 runtime decoders
      expect(l5Result.report.statesFound).toBe(0);
      expect(l5Result.report.statesReachable).toBe(0);
      expect(l5Result.report.dispatcher).toBeFalsy();
      expect(l5Result.report.closureAnalysis).toBeFalsy();
      expect(l5Result.report.roundtripVerified).toBe(true);
      expect(l5Result.report.confidence).toBe(1.0);
    });

    test('3. Executable verification via Lua/LuaJIT matches original stdout', () => {
      expect(l5Result).toBeTruthy();
      const os = require('os');
      const tmpPath = path.join(os.tmpdir(), `min_verify_${Date.now()}.lua`);
      fs.writeFileSync(tmpPath, l5Result.code, 'utf8');

      const candidates = ['luajit', 'lua', 'lua5.1'];
      let executed = false;
      try {
        for (const bin of candidates) {
          try {
            const run = spawnSync(bin, [tmpPath], { encoding: 'utf8', timeout: 2000 });
            if (run.status === 0) {
              expect(run.stdout.trim()).toBe('hi');
              executed = true;
              break;
            }
          } catch (_) {}
        }
      } finally {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
      }
      expect(executed).toBe(true);
    });

    test('4. Stage L4 fallback preserves structural pipeline invariants', () => {
      const source = fs.readFileSync(protectedPath, 'utf8');
      const l4Result = recover(source, { stage: 'L4', filename: 'minimal_print.lua' });

      // Stage L4 should not invoke L5 semantic oracle
      expect(['L3.5', 'L4']).toContain(l4Result.report.recoveryLevel);
      expect(l4Result.report.roundtripVerified).toBe(true);
      expect(l4Result.report.dispatcher).toBeTruthy();
      expect(l4Result.report.dispatcher.states).toBeGreaterThan(0);
    });

    test('5. Hardcoding audit: zero fixture hashes, state IDs, or filenames in packages/core', () => {
      const coreDir = path.resolve(__dirname, '../../packages/core/src');
      const forbiddenStrings = [
        '12110459', // Entry state ID of minimal_print
        '10387401', // Exit state ID
        '1788502618098', // Timestamp ID from filename
        'minimal_print', // Fixture name
        'b73a29b073dbe274bf0628bed415f494cbc0c757967c7fd51b85f10095835722' // SHA256 of protected
      ];

      function scanDir(dir) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            scanDir(fullPath);
          } else if (file.endsWith('.js')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            for (const forbidden of forbiddenStrings) {
              expect(content.includes(forbidden)).toBe(false);
            }
          }
        }
      }

      scanDir(coreDir);
    });
  });
}

module.exports = { runMinimalGroundTruthTests };

if (require.main === module) {
  runMinimalGroundTruthTests();
  const { printSummary } = require('../test-framework');
  printSummary();
}
