/**
 * Core Baseline Guard:
 * Performs startup/runtime verification of core recovery algorithm files against
 * the frozen Phase 1 baseline hashes recorded in audit/core-baseline-hashes.json.
 * 
 * Guarantees zero runtime corruption or unapproved modifications to frozen algorithms.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class CoreBaselineGuard {
  /**
   * @param {string} [auditFilePath]
   */
  constructor(auditFilePath) {
    this.auditFilePath = auditFilePath || path.resolve(__dirname, '../../../audit/core-baseline-hashes.json');
    this.baseline = null;
  }

  loadBaseline() {
    if (!fs.existsSync(this.auditFilePath)) {
      throw new Error(`Core baseline audit file not found: ${this.auditFilePath}`);
    }
    const raw = fs.readFileSync(this.auditFilePath, 'utf8');
    this.baseline = JSON.parse(raw);
    return this.baseline;
  }

  /**
   * Verifies all frozen files against their SHA-256 hashes.
   *
   * @param {string} [projectRoot]
   * @returns {{ verified: boolean, baselineTag: string, totalChecked: number, mismatches: Array<{ file: string, expected: string, actual: string }> }}
   */
  verify(projectRoot) {
    if (!this.baseline) {
      this.loadBaseline();
    }

    const root = projectRoot || path.resolve(__dirname, '../../../');
    const mismatches = [];
    let totalChecked = 0;

    const hashes = this.baseline.hashes || this.baseline.fileHashes || {};

    for (const [relPath, expectedHash] of Object.entries(hashes)) {
      const fullPath = path.join(root, relPath);
      totalChecked++;

      if (!fs.existsSync(fullPath)) {
        mismatches.push({
          file: relPath,
          expected: expectedHash,
          actual: 'FILE_NOT_FOUND'
        });
        continue;
      }

      const content = fs.readFileSync(fullPath);
      const actualHash = crypto.createHash('sha256').update(content).digest('hex');

      if (actualHash !== expectedHash) {
        mismatches.push({
          file: relPath,
          expected: expectedHash,
          actual: actualHash
        });
      }
    }

    return {
      verified: mismatches.length === 0,
      baselineTag: this.baseline.baselineTag,
      frozenAt: this.baseline.timestamp,
      totalChecked,
      mismatches
    };
  }

  /**
   * Asserts baseline integrity; throws if any mismatch is detected.
   *
   * @param {string} [projectRoot]
   */
  assertIntegrity(projectRoot) {
    const res = this.verify(projectRoot);
    if (!res.verified) {
      const details = res.mismatches.map(m => `${m.file} (expected ${m.expected.substring(0, 8)}, got ${m.actual.substring(0, 8)})`).join(', ');
      throw new Error(`CORE_BASELINE_VIOLATION: Core files modified or missing: ${details}`);
    }
    return res;
  }
}

module.exports = {
  CoreBaselineGuard
};
