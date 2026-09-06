/**
 * FinalAdmissionGate:
 * The single, canonical arbiter for L5-W whole-program deobfuscation admission.
 *
 * Implements the composed L5-W hard gate predicate:
 *   staticClosed
 *   && staticComplete
 *   && allRequiredProofsPresent
 *   && proofIntegrityPass
 *   && proofCompletenessPass
 *   && safeWholeProgramReplacement
 *   && noUnresolvedObligations
 *   && vmDetached
 *   && runtimeDecoderRemaining == false
 *   && protectionRuntimeRemaining == false
 *   && encodedStringsRemaining == 0
 *   && dispatcherStatesAfter == 0
 *   && oracleDidNotVeto
 *
 * Principle: Oracle can veto; Oracle cannot promote.
 * Zero duplicate admission decisions: all analyzers provide evidence;
 * only FinalAdmissionGate decides L5-W eligibility.
 */

class FinalAdmissionGate {
  /**
   * Evaluates all 5 constituent gates and produces the canonical decision.
   *
   * @param {object} params
   * @param {object} params.staticClosureGate
   * @param {boolean} params.staticClosureGate.wholeProgramClosed
   * @param {boolean} params.staticClosureGate.wholeProgramComplete
   * @param {object} params.proofGate
   * @param {boolean} params.proofGate.requiredProofsPass
   * @param {boolean} params.proofGate.proofIntegrityPass
   * @param {boolean} params.proofGate.proofCompletenessPass
   * @param {Array<string>} params.proofGate.unresolvedObligations
   * @param {object} params.replacementGate
   * @param {boolean} params.replacementGate.safeWholeProgramReplacement
   * @param {object} params.cleanupGate
   * @param {boolean} params.cleanupGate.vmDetached
   * @param {number} params.cleanupGate.dispatcherStatesAfter
   * @param {number} params.cleanupGate.encodedStringsRemaining
   * @param {boolean} params.cleanupGate.runtimeDecoderRemaining
   * @param {boolean} params.cleanupGate.protectionRuntimeRemaining
   * @param {object} params.oracleGate
   * @param {boolean} params.oracleGate.veto
   * @param {boolean} params.oracleGate.positiveEvidenceUsed
   * @returns {{ finalEligible: boolean, failureReasons: string[], decisionGraph: object }}
   */
  static evaluate({
    staticClosureGate = {},
    proofGate = {},
    replacementGate = {},
    cleanupGate = {},
    oracleGate = {}
  } = {}) {
    const staticClosed = !!staticClosureGate.wholeProgramClosed;
    const staticComplete = !!staticClosureGate.wholeProgramComplete;

    const requiredProofsPass = !!proofGate.requiredProofsPass;
    const proofIntegrityPass = !!proofGate.proofIntegrityPass;
    const unresolvedObligations = proofGate.unresolvedObligations || [];
    const proofCompletenessPass = !!proofGate.proofCompletenessPass && unresolvedObligations.length === 0;

    const safeReplacement = !!replacementGate.safeWholeProgramReplacement;

    const vmDetached = cleanupGate.vmDetached !== false;
    const dispatcherStatesAfter = cleanupGate.dispatcherStatesAfter ?? 0;
    const encodedStringsRemaining = cleanupGate.encodedStringsRemaining ?? 0;
    const runtimeDecoderRemaining = !!cleanupGate.runtimeDecoderRemaining;
    const protectionRuntimeRemaining = !!cleanupGate.protectionRuntimeRemaining;

    const oracleVeto = !!oracleGate.veto;
    const positiveEvidenceUsed = !!oracleGate.positiveEvidenceUsed;

    const cleanupPass = (
      vmDetached &&
      dispatcherStatesAfter === 0 &&
      encodedStringsRemaining === 0 &&
      !runtimeDecoderRemaining &&
      !protectionRuntimeRemaining
    );

    const staticPass = staticClosed && staticComplete;
    const proofPass = requiredProofsPass && proofIntegrityPass && proofCompletenessPass && unresolvedObligations.length === 0;
    const replacementPass = safeReplacement;
    const oraclePass = !oracleVeto && !positiveEvidenceUsed;

    const finalEligible = (
      staticPass &&
      proofPass &&
      replacementPass &&
      cleanupPass &&
      oraclePass
    );

    const failureReasons = [];
    if (!staticClosed) failureReasons.push('STATIC_CLOSURE_FAIL: external inputs or open environment detected');
    if (!staticComplete) failureReasons.push('STATIC_COMPLETENESS_FAIL: unobserved blocks or unresolved branches');
    if (!requiredProofsPass) failureReasons.push(`REQUIRED_PROOFS_FAIL: missing ${unresolvedObligations.join(', ')}`);
    if (!proofIntegrityPass) failureReasons.push('PROOF_INTEGRITY_FAIL: prohibited provenance or trace contamination');
    if (!proofCompletenessPass) failureReasons.push(`PROOF_COMPLETENESS_FAIL: unresolved obligations [${unresolvedObligations.join(', ')}]`);
    if (!safeReplacement) failureReasons.push('SAFE_REPLACEMENT_FAIL: whole program replacement prohibited');
    if (!vmDetached) failureReasons.push('CLEANUP_FAIL: VM state variable or registers still referenced');
    if (dispatcherStatesAfter > 0) failureReasons.push(`CLEANUP_FAIL: ${dispatcherStatesAfter} residual dispatcher states`);
    if (encodedStringsRemaining > 0) failureReasons.push(`CLEANUP_FAIL: ${encodedStringsRemaining} encoded strings remain`);
    if (runtimeDecoderRemaining) failureReasons.push('CLEANUP_FAIL: runtime decoder remains in output');
    if (protectionRuntimeRemaining) failureReasons.push('CLEANUP_FAIL: protection runtime remains in output');
    if (oracleVeto) failureReasons.push('ORACLE_VETO: dynamic trace execution failed');
    if (positiveEvidenceUsed) failureReasons.push('ORACLE_TAINT: prohibited positive oracle evidence used');

    return {
      finalEligible,
      failureReasons,
      decisionGraph: {
        staticClosureGate: {
          wholeProgramClosed: staticClosed,
          wholeProgramComplete: staticComplete
        },
        proofGate: {
          requiredProofsPass,
          proofIntegrityPass,
          proofCompletenessPass,
          unresolvedObligations
        },
        replacementGate: {
          safeWholeProgramReplacement: safeReplacement
        },
        cleanupGate: {
          vmDetached,
          dispatcherStatesAfter,
          encodedStringsRemaining,
          runtimeDecoderRemaining,
          protectionRuntimeRemaining
        },
        oracleGate: {
          veto: oracleVeto,
          positiveEvidenceUsed
        },
        finalEligible
      }
    };
  }
}

module.exports = { FinalAdmissionGate };
