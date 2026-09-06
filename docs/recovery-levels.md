# Valax Recovery Levels Architecture

This document defines the formal recovery level taxonomy implemented in Valax Source Recovery (`v0.1.0-beta.1`).

Valax operates strictly on **evidence-backed static recovery**. It categorically rejects speculative synthesis, pattern guessing, or oracle-assisted text emission.

---

## Recovery Level Taxonomy

| Level | Classification | Description | Guarantees |
| :--- | :--- | :--- | :--- |
| **L0** | Raw Obfuscated | Untouched input code. | Syntactic preservation only. |
| **L1** | Normalized Ast | Normalized AST representations and standardized lexical structure. | Standard AST tree. |
| **L2** | Constant & String Fold | Static string tables decoded, numeric expressions normalized, dead branches pruned. | Preserved semantics, simplified literals. |
| **L3** | CFG Reconstruction | Control-flow graph generated, basic blocks recognized, state transitions mapped. | Valid CFG, deterministic state machine graph. |
| **L4** | Structural Invariant Baseline | Dispatcher compression applied, functions identified, unresolvable transitions preserved. | Zero speculative pruning, safe execution fallback. |
| **L4.5** | Partial Structural Lifting | High-level semantic operations (closures, branches, table lookups) lifted with provenance. | Partial lifting proven, residual dispatcher bounded. |
| **L5-W** | Closed Whole-Program Equivalence | Complete whole-program reconstruction to clean high-level Lua AST without VM runtime dependencies. | 0 dispatcher references, 0 VM registers, 0 helpers. |

---

## Detailed Level Explanations

### Level L4: Structural Invariant Baseline
When analyzing open programs, metamorphic variants, or complex obfuscated scripts with external interactions (such as event callbacks, external metatables, or dynamic state variables), the complete state machine cannot be collapsed without introducing speculative assumptions.

In such cases, Valax **conservatively retains the code at L4**.
- Obfuscated string constants and numeric expressions are fully decoded.
- Local variable aliasing is resolved.
- Basic blocks and control-flow graphs are normalized.
- The virtual machine dispatcher structure is preserved safely without speculative deletion.
- **Guarantee**: Zero silent corruption, zero false promotion.

### Level L4.5: Partial Structural Lifting
In intermediate or multi-feature obfuscations (such as nested factories or isolated stateful branches), sub-graphs of the state machine can be proven to represent high-level language constructs (e.g. `ClosureNode`, `UpvalueMutation`, `StatefulBranch`).
- Lifted operations are recorded as formal `SemanticOp` instances with bidirectional provenance.
- The remaining state transitions are maintained in a compressed residual dispatcher.
- Whole-program replacement is blocked until all 9 completeness axes are satisfied.

### Level L5-W: Closed Whole-Program Static Equivalence
L5-W represents complete, evidence-backed source reconstruction for statically closed programs.

To qualify for L5-W admission, a program must satisfy:
1. **Zero Prohibited Fallbacks**: Return arity, branch outcomes, and captured environments must be derived dynamically from static IR; hardcoded numeric guesses (such as speculative arity defaults) are strictly rejected.
2. **9-Axis Semantic Completeness**: The `SemanticGraphCompletenessVerifier` must verify all 9 invariant axes:
   - Source Closures
   - Lexical Bindings
   - Call Hierarchy
   - Branch Conditions
   - Return Value Expansions
   - Table Identifiers
   - Vararg Unpacking
   - Sequential Side Effects
   - Evaluation Order Graph
3. **Total VM Runtime Detachment**: The synthesized AST chunk is passed to `VMDependencyGraph`, which must verify:
   - 0 Dispatcher variable references
   - 0 VM register indexing (`b[...]`, `k[...]`)
   - 0 Runtime helper invocations (`M`, `X`, `Y`, `Q`, `W`, `o`)
   - 0 Instruction decoder routines (`l`, `H`, `K`, `V`, `C`)
   - 0 VM tuple transport constructs (`U`)
4. **Mandatory Proof Bundle**: All 9 required proofs must be formally present and validated by `RequiredProofValidator`.

If any requirement fails, the recovery is deterministically downgraded to **L4** or **L4.5**.
