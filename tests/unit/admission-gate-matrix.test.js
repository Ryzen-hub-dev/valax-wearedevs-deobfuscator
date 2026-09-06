const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { describe, test } = require('../test-framework');
const { FinalAdmissionGate } = require('../../packages/core/src/analysis/final-admission-gate');
const { recover } = require('../../packages/core/src');

function runAdmissionGateMatrixTests() {
  describe('L5-W Admission Gate Composition & Integration Matrix (P0-12)', () => {

    const createBaselineGateInputs = () => ({
      staticClosureGate: {
        wholeProgramClosed: true,
        wholeProgramComplete: true
      },
      proofGate: {
        requiredProofsPass: true,
        proofIntegrityPass: true,
        proofCompletenessPass: true,
        unresolvedObligations: []
      },
      replacementGate: {
        safeWholeProgramReplacement: true
      },
      cleanupGate: {
        vmDetached: true,
        dispatcherStatesAfter: 0,
        encodedStringsRemaining: 0,
        runtimeDecoderRemaining: false,
        protectionRuntimeRemaining: false
      },
      oracleGate: {
        veto: false,
        positiveEvidenceUsed: false
      }
    });

    // 1. Baseline Valid L5-W
    test('1. Baseline valid L5-W produces finalEligible = true and L5-W recovery', () => {
      const inputs = createBaselineGateInputs();
      const decision = FinalAdmissionGate.evaluate(inputs);
      assert.strictEqual(decision.finalEligible, true);
      assert.strictEqual(decision.failureReasons.length, 0);

      // Real pipeline execution on minimal_print
      const fixturePath = path.resolve(__dirname, '../fixtures/wearedevs/minimal_print/protected.lua');
      const source = fs.readFileSync(fixturePath, 'utf8');
      const res = recover(source, { stage: 'L5', filename: 'minimal_print.lua' });
      assert.strictEqual(res.report.recoveryLevel, 'L5-W');
      assert.strictEqual(res.report.completeness.isL5WEligible, true);
    });

    // 2. Required Proof Missing
    test('2. Required proof missing rejects L5-W', () => {
      const inputs = createBaselineGateInputs();
      inputs.proofGate.requiredProofsPass = false;
      inputs.proofGate.unresolvedObligations = ['PERSISTENT_UPVALUE_STATE'];
      const decision = FinalAdmissionGate.evaluate(inputs);
      assert.strictEqual(decision.finalEligible, false);
      assert(decision.failureReasons.some(r => r.includes('REQUIRED_PROOFS_FAIL')));
    });

    // 3. Safe Replacement False
    test('3. safeWholeProgramReplacement = false rejects L5-W', () => {
      const inputs = createBaselineGateInputs();
      inputs.replacementGate.safeWholeProgramReplacement = false;
      const decision = FinalAdmissionGate.evaluate(inputs);
      assert.strictEqual(decision.finalEligible, false);
      assert(decision.failureReasons.some(r => r.includes('SAFE_REPLACEMENT_FAIL')));
    });

    // 4. wholeProgramComplete False
    test('4. wholeProgramComplete = false rejects L5-W', () => {
      const inputs = createBaselineGateInputs();
      inputs.staticClosureGate.wholeProgramComplete = false;
      const decision = FinalAdmissionGate.evaluate(inputs);
      assert.strictEqual(decision.finalEligible, false);
      assert(decision.failureReasons.some(r => r.includes('STATIC_COMPLETENESS_FAIL')));
    });

    // 5. Proof Integrity Fail
    test('5. Proof integrity failure rejects L5-W', () => {
      const inputs = createBaselineGateInputs();
      inputs.proofGate.proofIntegrityPass = false;
      const decision = FinalAdmissionGate.evaluate(inputs);
      assert.strictEqual(decision.finalEligible, false);
      assert(decision.failureReasons.some(r => r.includes('PROOF_INTEGRITY_FAIL')));
    });

    // 6. Unresolved Obligation
    test('6. Unresolved obligations reject L5-W', () => {
      const inputs = createBaselineGateInputs();
      inputs.proofGate.unresolvedObligations = ['CALL_TARGET_RESOLUTION'];
      const decision = FinalAdmissionGate.evaluate(inputs);
      assert.strictEqual(decision.finalEligible, false);
      assert(decision.failureReasons.some(r => r.includes('PROOF_COMPLETENESS_FAIL')));
    });

    // 7. Dispatcher Residual
    test('7. Dispatcher states remaining (dispatcherStatesAfter > 0) rejects L5-W', () => {
      const inputs = createBaselineGateInputs();
      inputs.cleanupGate.dispatcherStatesAfter = 1;
      const decision = FinalAdmissionGate.evaluate(inputs);
      assert.strictEqual(decision.finalEligible, false);
      assert(decision.failureReasons.some(r => r.includes('residual dispatcher states')));
    });

    // 8. Decoder Residual
    test('8. Runtime decoder remaining rejects L5-W', () => {
      const inputs = createBaselineGateInputs();
      inputs.cleanupGate.runtimeDecoderRemaining = true;
      const decision = FinalAdmissionGate.evaluate(inputs);
      assert.strictEqual(decision.finalEligible, false);
      assert(decision.failureReasons.some(r => r.includes('runtime decoder remains')));
    });

    // 9. Protection Runtime Residual
    test('9. Protection runtime remaining rejects L5-W', () => {
      const inputs = createBaselineGateInputs();
      inputs.cleanupGate.protectionRuntimeRemaining = true;
      const decision = FinalAdmissionGate.evaluate(inputs);
      assert.strictEqual(decision.finalEligible, false);
      assert(decision.failureReasons.some(r => r.includes('protection runtime remains')));
    });

    // 10. Encoded String Residual
    test('10. Encoded string residual (encodedStringsRemaining > 0) rejects L5-W', () => {
      const inputs = createBaselineGateInputs();
      inputs.cleanupGate.encodedStringsRemaining = 1;
      const decision = FinalAdmissionGate.evaluate(inputs);
      assert.strictEqual(decision.finalEligible, false);
      assert(decision.failureReasons.some(r => r.includes('encoded strings remain')));
    });

    // 11. vmDetached False
    test('11. vmDetached = false rejects L5-W', () => {
      const inputs = createBaselineGateInputs();
      inputs.cleanupGate.vmDetached = false;
      const decision = FinalAdmissionGate.evaluate(inputs);
      assert.strictEqual(decision.finalEligible, false);
      assert(decision.failureReasons.some(r => r.includes('VM state variable or registers still referenced')));
    });

    // 12. Oracle Veto
    test('12. Oracle veto (traceResult.success = false) rejects L5-W', () => {
      const inputs = createBaselineGateInputs();
      inputs.oracleGate.veto = true;
      const decision = FinalAdmissionGate.evaluate(inputs);
      assert.strictEqual(decision.finalEligible, false);
      assert(decision.failureReasons.some(r => r.includes('ORACLE_VETO')));
    });

    // 13. Static Fail + Oracle Pass
    test('13. Static fail + Oracle pass strictly forbids promotion to L5-W', () => {
      const inputs = createBaselineGateInputs();
      inputs.staticClosureGate.wholeProgramClosed = false;
      inputs.oracleGate.veto = false;
      inputs.oracleGate.positiveEvidenceUsed = false;
      const decision = FinalAdmissionGate.evaluate(inputs);
      assert.strictEqual(decision.finalEligible, false);
      assert(decision.failureReasons.some(r => r.includes('STATIC_CLOSURE_FAIL')));

      // Real pipeline verification with genuine negative sample neg_01_free_foo
      const negPath = path.resolve(__dirname, '../temp/adversarial-admissions/neg_01_free_foo/protected.lua');
      if (fs.existsSync(negPath)) {
        const negSrc = fs.readFileSync(negPath, 'utf8');
        const res = recover(negSrc, { stage: 'L5', filename: 'neg_01.lua' });
        assert.notStrictEqual(res.report.recoveryLevel, 'L5-W');
        assert.strictEqual(res.report.recoveryLevel, 'L4');
        assert.strictEqual(res.report.completeness.isL5WEligible, false);
      }
    });

  });
}

module.exports = { runAdmissionGateMatrixTests };
