# Valax Source Recovery — Universal Compatibility & Corpus Matrix

> [!IMPORTANT]
> **Separation of Metrics:** Source corpus programs and genuine protected WeAreDevs fixtures are evaluated separately.
> **Current Universal Readiness:** **CORE_ALPHA** (2 real unpaired protected fixtures, 2 seeds represented, 0 paired fixtures).

## 1. Protected WeAreDevs Compatibility Matrix

* **Total Real Protected Fixtures:** 2
* **Paired Protected Fixtures (Gate A):** 0
* **Unpaired Protected Fixtures:** 2
* **Protected Seeds Represented:** 2
* **Structural Families Identified:** 2
  - **Variant_Family_A_WeAreDevs_BST_Alphabet**: 1
  - **Variant_Family_A2_BST_Alphabet_Compact**: 1
* **Protected Parse Rate:** 100%
* **Protected Detection Rate:** 100%
* **Protected Crash-Free Rate:** 100%
* **Protected High Recovery Rate (L4):** 100%
* **Protected Semantic Pass Rate:** Not Eligible (No matching original source available for unpaired fixtures)
* **Silent Semantic Corruptions:** 0

| Fixture ID | Type | Generator | Seed | Family | Dispatcher States | Extracted | Level | Roundtrip | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `fixture_0001_byidiotsandwich` | UNPAIRED_REAL_PROTECTED_FIXTURE | WeAreDevs v1.0.0 | seed_001 | Variant_Family_A_WeAreDevs_BST_Alphabet | 610 → 425 | 185 | L4 | PASS | **HIGH** |
| `fixture_unpaired_0002_bymethion` | UNPAIRED_REAL_PROTECTED_FIXTURE | WeAreDevs v1.0.0 | seed_002 | Variant_Family_A2_BST_Alphabet_Compact | 72 → 67 | 5 | L4 | PASS | **HIGH** |

## 2. Original Source Corpus Baseline (Unprotected Lua/Luau)

* **Total Original Programs:** 103
* **Categories Covered:** 16 language categories (Levels 1–5)
* **Source Parse Rate:** 95.1% (98 / 103 clean 5.1/5.2 syntax; 5 Luau type annotations categorized as `TYPED_LUAU_UNSUPPORTED`)
* **Source Normalization & Round-Trip Rate:** 100% of parsed programs
