const { FailureCategory } = require('../diagnostics/failure-taxonomy');

const VALID_STATIC_SOURCES = new Set([
  'STATIC_AST',
  'STATIC_IR',
  'STATIC_VM_LIFTING',
  'CFG',
  'POINTS_TO',
  'ABSTRACT_INTERPRETATION'
]);

const PROHIBITED_INTERNAL_SOURCES = new Set([
  'SEMANTIC_TRACE',
  'EXPECTED_SOURCE',
  'FIXTURE_METADATA',
  'ORACLE_TRACE'
]);

class ProofIntegrityValidator {
  constructor() {}

  /**
   * Validates proof provenance and structural authenticity.
   * Ensures no internal semantic proof was synthesized from dynamic trace events, counts, or expected output.
   *
   * @param {object} completenessInfo
   * @param {object} [options]
   * @returns {object} { pass: boolean, violations: string[], failureCategory?: string }
   */
  validate(completenessInfo, options = {}) {
    const violations = [];

    if (!completenessInfo) {
      return { pass: true, violations: [] };
    }

    const mixed = completenessInfo.mixedClosed;
    if (mixed) {
      // 1. Check prohibited sources in provenance
      const provenances = [
        { name: 'vararg', prov: mixed.varargProvenance },
        { name: 'closure', prov: mixed.closureProvenance },
        { name: 'state', prov: mixed.stateProvenance },
        { name: 'branch', prov: mixed.branchProvenance },
        { name: 'multiReturn', prov: mixed.multiReturnProvenance },
        { name: 'tableIdentity', prov: mixed.tableIdentityProvenance },
        { name: 'evaluationOrder', prov: mixed.evaluationOrderProvenance }
      ];

      for (const { name, prov } of provenances) {
        if (!prov) {
          // If the feature is claimed recovered/proven, missing provenance is a violation
          if (
            (name === 'vararg' && mixed.varargRecovered) ||
            (name === 'closure' && mixed.closureRecovered) ||
            (name === 'state' && mixed.persistentStateProven) ||
            (name === 'branch' && mixed.branchOutcomes?.length > 0) ||
            (name === 'multiReturn' && mixed.multiReturnValueCount > 0) ||
            (name === 'tableIdentity' && mixed.capturedTableIdentityProven) ||
            (name === 'evaluationOrder' && mixed.evaluationOrderProven)
          ) {
            violations.push(`MISSING_PROVENANCE: Proof for '${name}' has no provenance record.`);
          }
        } else {
          const src = prov.source;
          if (PROHIBITED_INTERNAL_SOURCES.has(src)) {
            violations.push(
              `PROHIBITED_SOURCE: Proof for '${name}' originates from prohibited source '${src}'. Internal semantics must be proven via static analysis.`
            );
          } else if (!VALID_STATIC_SOURCES.has(src)) {
            violations.push(
              `INVALID_SOURCE: Proof for '${name}' specifies unrecognized source '${src}'.`
            );
          }
        }
      }

      // 2. Anti-Oracle-Synthesis: verify proof fields are not synthesized from trace counts
      if (mixed.safeWholeProgramReplacement) {
        // If whole program replacement is claimed, verify all required static proofs exist
        if (!mixed.varargToTableExpansionProven) {
          violations.push('UNPROVEN_PREREQUISITE: varargToTableExpansionProven is false');
        }
        if (!mixed.closureRecovered) {
          violations.push('UNPROVEN_PREREQUISITE: closureRecovered is false');
        }
        if (!mixed.capturedTableIdentityProven) {
          violations.push('UNPROVEN_PREREQUISITE: capturedTableIdentityProven is false');
        }
        if (!mixed.persistentStateProven) {
          violations.push('UNPROVEN_PREREQUISITE: persistentStateProven is false');
        }
        if (!mixed.multiReturnExpansionProven) {
          violations.push('UNPROVEN_PREREQUISITE: multiReturnExpansionProven is false');
        }
        if (!mixed.evaluationOrderProven) {
          violations.push('UNPROVEN_PREREQUISITE: evaluationOrderProven is false');
        }

        // 3. Captured binding integrity: must not be empty or ungrounded
        if (!Array.isArray(mixed.capturedBindings) || mixed.capturedBindings.length === 0) {
          violations.push('EMPTY_CAPTURED_BINDINGS: capturedBindings cannot be empty when closure is proven.');
        }

        // 4. Branch outcomes integrity: if branches exist, outcomes must be boolean array from abstract interpretation
        if (mixed.branchProvenance && mixed.branchProvenance.source === 'ABSTRACT_INTERPRETATION') {
          if (!Array.isArray(mixed.branchOutcomes)) {
            violations.push('INVALID_BRANCH_OUTCOMES: branchOutcomes must be an array.');
          }
        }

        // 5. MultiReturn count integrity
        if (typeof mixed.multiReturnValueCount !== 'number' || mixed.multiReturnValueCount < 1) {
          violations.push('INVALID_MULTIRETURN_COUNT: multiReturnValueCount must be a positive integer.');
        }
      }
    }

    const hasOracleViolation = violations.some(v => v.includes('PROHIBITED_SOURCE') || v.includes('MISSING_PROVENANCE'));
    const pass = violations.length === 0;

    return {
      pass,
      violations,
      failureCategory: pass
        ? null
        : (hasOracleViolation ? FailureCategory.ORACLE_DRIVEN_PROOF_SYNTHESIS : FailureCategory.PROOF_INTEGRITY_FAILURE)
    };
  }
}

module.exports = {
  ProofIntegrityValidator,
  VALID_STATIC_SOURCES,
  PROHIBITED_INTERNAL_SOURCES
};
