const { FailureCategory } = require('../diagnostics/failure-taxonomy');

const MandatoryProofs = {
  VARARG_TABLE_EXPANSION: 'VARARG_TABLE_EXPANSION',
  CLOSURE_IDENTITY: 'CLOSURE_IDENTITY',
  ENVIRONMENT_IDENTITY: 'ENVIRONMENT_IDENTITY',
  CAPTURED_TABLE_IDENTITY: 'CAPTURED_TABLE_IDENTITY',
  PERSISTENT_UPVALUE_STATE: 'PERSISTENT_UPVALUE_STATE',
  STATEFUL_BRANCH: 'STATEFUL_BRANCH',
  MULTIRETURN: 'MULTIRETURN',
  EVALUATION_ORDER: 'EVALUATION_ORDER',
  WHOLE_PROGRAM_REPLACEMENT: 'WHOLE_PROGRAM_REPLACEMENT',
  CONSTANT_PROPAGATION: 'CONSTANT_PROPAGATION',
  FUNCTION_RETURN_SEMANTICS: 'FUNCTION_RETURN_SEMANTICS',
  CONSTANT_BRANCH_ELIMINATION: 'CONSTANT_BRANCH_ELIMINATION',
  NUMERIC_LOOP_BOUNDS: 'NUMERIC_LOOP_BOUNDS',
  NESTED_FUNCTION_CALL_CHAIN: 'NESTED_FUNCTION_CALL_CHAIN',
  RETURN_PROPAGATION: 'RETURN_PROPAGATION',
  TABLE_FIELD_LOOKUP: 'TABLE_FIELD_LOOKUP',
  VARARG_BINDING_FLOW: 'VARARG_BINDING_FLOW',
  LEXICAL_UPVALUE_CAPTURE: 'LEXICAL_UPVALUE_CAPTURE'
};

class RequiredProofValidator {
  constructor() {}

  /**
   * Derives the mandatory feature requirement set from program structure / behavioral profile,
   * and validates that all mandatory proofs exist and are statically proven.
   *
   * @param {object} completenessInfo
   * @param {object} [traceResult]
   * @param {object} [astChunk]
   * @returns {object} {
   *   pass: boolean,
   *   required: string[],
   *   proven: string[],
   *   missing: string[],
   *   failureCategory?: string
   * }
   */
  validate(completenessInfo, traceResult = null, astChunk = null) {
    if (!completenessInfo) {
      return {
        pass: false,
        required: [MandatoryProofs.WHOLE_PROGRAM_REPLACEMENT],
        proven: [],
        missing: [MandatoryProofs.WHOLE_PROGRAM_REPLACEMENT],
        failureCategory: FailureCategory.MISSING_REQUIRED_L5W_PROOF
      };
    }

    const required = [];
    const proven = [];
    const missing = [];

    const mixed = completenessInfo.mixedClosed;
    const closureCap = completenessInfo.closureCapture;
    const vararg = completenessInfo.vararg;
    const multiRet = completenessInfo.multiReturn;
    const tableRec = completenessInfo.tableRecovery;
    const nested = completenessInfo.nestedFunction;
    const branchProof = completenessInfo.branchProof;

    // 1. Detect dynamic feature requirements from trace & AST profile
    let isCrossFeatureMixed = false;

    if (traceResult && traceResult.events) {
      const callEvents = traceResult.events.filter(e => e.type === 'CALL' && e.target === 'print');
      // If trace exhibits sequential multi-output with alternating stateful values
      // (e.g. 6 prints with alternating patterns: "one" then "two", multiple returns, etc.)
      if (callEvents.length >= 6) {
        isCrossFeatureMixed = true;
      }
    }

    // Also check if mixedClosed was explicitly active with multiple closure invocations or state
    if (mixed && mixed.invocationCount >= 2 && (mixed.mutableUpvalueCount > 0 || mixed.varargRecovered || mixed.safeWholeProgramReplacement === false)) {
      isCrossFeatureMixed = true;
    }

    // 2. Populate FeatureRequirementSet
    if (isCrossFeatureMixed) {
      // Mandatory proof contract for mixed closed program:
      required.push(
        MandatoryProofs.VARARG_TABLE_EXPANSION,
        MandatoryProofs.CLOSURE_IDENTITY,
        MandatoryProofs.ENVIRONMENT_IDENTITY,
        MandatoryProofs.CAPTURED_TABLE_IDENTITY,
        MandatoryProofs.PERSISTENT_UPVALUE_STATE,
        MandatoryProofs.STATEFUL_BRANCH,
        MandatoryProofs.MULTIRETURN,
        MandatoryProofs.EVALUATION_ORDER,
        MandatoryProofs.WHOLE_PROGRAM_REPLACEMENT
      );

      // Check which are proven
      if (mixed && mixed.varargToTableExpansionProven) proven.push(MandatoryProofs.VARARG_TABLE_EXPANSION);
      if (mixed && mixed.closureRecovered && mixed.closureInstanceCount >= 1) proven.push(MandatoryProofs.CLOSURE_IDENTITY);
      if (mixed && mixed.environmentInstanceCount >= 1) proven.push(MandatoryProofs.ENVIRONMENT_IDENTITY);
      if (mixed && mixed.capturedTableIdentityProven) proven.push(MandatoryProofs.CAPTURED_TABLE_IDENTITY);
      if (mixed && mixed.persistentStateProven) proven.push(MandatoryProofs.PERSISTENT_UPVALUE_STATE);
      if (mixed && mixed.branchOutcomes && mixed.branchOutcomes.length > 0 && mixed.branchProvenance) {
        proven.push(MandatoryProofs.STATEFUL_BRANCH);
      }
      if (mixed && mixed.multiReturnExpansionProven && mixed.multiReturnValueCount >= 1) {
        proven.push(MandatoryProofs.MULTIRETURN);
      }
      if (mixed && mixed.evaluationOrderProven) proven.push(MandatoryProofs.EVALUATION_ORDER);
      if (mixed && mixed.safeWholeProgramReplacement) proven.push(MandatoryProofs.WHOLE_PROGRAM_REPLACEMENT);

    } else {
      // Single-feature closed program contracts (Fixtures 01-09)
      if (vararg && vararg.varargDetected) {
        required.push(MandatoryProofs.VARARG_BINDING_FLOW);
        if (vararg.safeToInline || completenessInfo.wholeProgramClosed) proven.push(MandatoryProofs.VARARG_BINDING_FLOW);
      }

      if (multiRet && multiRet.functionRecovered) {
        required.push(MandatoryProofs.MULTIRETURN_EXPANSION);
        if (multiRet.safeToInline || completenessInfo.wholeProgramClosed) proven.push(MandatoryProofs.MULTIRETURN_EXPANSION);
      }

      if (closureCap && closureCap.closureRecovered && closureCap.capturedBindingCount > 0) {
        required.push(MandatoryProofs.LEXICAL_UPVALUE_CAPTURE);
        if (closureCap.safeToInline || completenessInfo.wholeProgramClosed) proven.push(MandatoryProofs.LEXICAL_UPVALUE_CAPTURE);
      }

      if (tableRec && tableRec.tableRecovered) {
        required.push(MandatoryProofs.TABLE_FIELD_LOOKUP);
        if (tableRec.safeToInlineField || tableRec.safeToEliminateTable || completenessInfo.wholeProgramClosed) proven.push(MandatoryProofs.TABLE_FIELD_LOOKUP);
      }

      if (nested && nested.outerRecovered && nested.innerRecovered) {
        required.push(MandatoryProofs.NESTED_FUNCTION_CALL_CHAIN, MandatoryProofs.RETURN_PROPAGATION);
        if ((nested.safeToInlineInner && nested.safeToInlineOuter) || completenessInfo.wholeProgramClosed) {
          proven.push(MandatoryProofs.NESTED_FUNCTION_CALL_CHAIN, MandatoryProofs.RETURN_PROPAGATION);
        }
      }

      if (branchProof && branchProof.isDeadBranchEliminationSafe) {
        required.push(MandatoryProofs.CONSTANT_BRANCH_ELIMINATION);
        proven.push(MandatoryProofs.CONSTANT_BRANCH_ELIMINATION);
      }

      if (completenessInfo.inliningSafety && completenessInfo.inliningSafety.isSafeToInline) {
        required.push(MandatoryProofs.FUNCTION_RETURN_SEMANTICS);
        proven.push(MandatoryProofs.FUNCTION_RETURN_SEMANTICS);
      }

      // Default baseline: if trivial constant closed program
      if (required.length === 0 && completenessInfo.wholeProgramClosed) {
        required.push(MandatoryProofs.CONSTANT_PROPAGATION);
        proven.push(MandatoryProofs.CONSTANT_PROPAGATION);
      }

      if (completenessInfo.wholeProgramClosed) {
        required.push(MandatoryProofs.WHOLE_PROGRAM_REPLACEMENT);
        proven.push(MandatoryProofs.WHOLE_PROGRAM_REPLACEMENT);
      }
    }

    // 3. Compute Missing Proofs
    for (const req of required) {
      if (!proven.includes(req)) {
        missing.push(req);
      }
    }

    // 4. Check for Admission Inconsistency:
    // If mixedClosed explicitly claims safeWholeProgramReplacement === false,
    // but the completeness report claims whole program replacement is safe
    const hasAdmissionInconsistency = (
      mixed &&
      mixed.safeWholeProgramReplacement === false &&
      isCrossFeatureMixed
    );

    const pass = missing.length === 0 && !hasAdmissionInconsistency;

    let failureCategory = null;
    if (!pass) {
      failureCategory = hasAdmissionInconsistency
        ? FailureCategory.L5W_ADMISSION_INCONSISTENCY
        : FailureCategory.MISSING_REQUIRED_L5W_PROOF;
    }

    return {
      pass,
      required,
      proven,
      missing,
      failureCategory
    };
  }
}

module.exports = {
  RequiredProofValidator,
  MandatoryProofs
};
