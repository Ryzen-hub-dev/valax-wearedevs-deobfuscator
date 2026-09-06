# Valax Recovery Report Schema (Version 1)

All reports produced by the Valax Source Recovery engine adhere to the versioned `schemaVersion: "1"` specification.

---

## Example Schema Document

```json
{
  "schemaVersion": "1",
  "toolVersion": "0.1.0-beta.1",
  "status": "success",
  "input": {
    "filename": "sample.lua",
    "bytes": 18956,
    "sha256": "2e5276febffbd9b3dee32f571ee4620cf91ce04dfb13b2c1061348a836406ffa"
  },
  "detection": {
    "family": "WeAreDevs",
    "version": "1.0.0",
    "confidence": 1.0
  },
  "recovery": {
    "requestedStage": "auto",
    "actualLevel": "L4",
    "isL5WEligible": false,
    "dispatcherStatesBefore": 76,
    "dispatcherStatesAfter": 58,
    "encodedStringsRemaining": 0,
    "runtimeDecoderRemaining": false,
    "protectionRuntimeRemaining": true
  },
  "validation": {
    "semantic": "PASS"
  },
  "proof": {
    "integrity": true,
    "completeness": false,
    "details": "Evidence-backed static recovery complete."
  },
  "warnings": [],
  "failureCategory": null,
  "timing": {
    "totalMs": 142
  },
  "reproducibility": {
    "sha256": "2e5276febffbd9b3dee32f571ee4620cf91ce04dfb13b2c1061348a836406ffa",
    "toolVersion": "0.1.0-beta.1",
    "nodeVersion": "v24.18.0",
    "platform": "win32",
    "options": {
      "requestedStage": "auto"
    }
  }
}
```

---

## Field Specifications

### Top-Level Attributes
- **`schemaVersion`** (`string`): Report schema specification version (currently `"1"`).
- **`toolVersion`** (`string`): Version of the Valax recovery engine (currently `"0.1.0-beta.1"`).
- **`status`** (`string`): Overall recovery outcome: `"success"` or `"failure"`.

### `input` Object
- **`filename`** (`string`): Logical basename of the input script. Absolute host paths are strictly omitted for data privacy.
- **`bytes`** (`number`): Size of the input script in bytes.
- **`sha256`** (`string`): Cryptographic SHA256 digest of the input source for reproducibility.

### `detection` Object
- **`family`** (`string`): Obfuscator profile identified (e.g. `"WeAreDevs"`).
- **`version`** (`string`): Detected obfuscator version (e.g. `"1.0.0"`).
- **`confidence`** (`number`): Structural detection confidence metric ($0.0$ to $1.0$).

### `recovery` Object
- **`requestedStage`** (`string`): Stage requested by caller (`"auto"`, `"L4"`, or `"L5-W"`).
- **`actualLevel`** (`string`): Actual verified recovery level (`"L4"`, `"L4.5"`, or `"L5-W"`).
- **`isL5WEligible`** (`boolean`): Whether the script satisfied all 9 axes for whole-program static replacement.
- **`dispatcherStatesBefore`** (`number`): Original number of dispatcher states detected.
- **`dispatcherStatesAfter`** (`number`): Number of residual states remaining in the output.
- **`encodedStringsRemaining`** (`number`): Unresolved encrypted string references.
- **`runtimeDecoderRemaining`** (`boolean`): Whether runtime decoding routines remain in output.
- **`protectionRuntimeRemaining`** (`boolean`): Whether VM interpreter runtime remains in output.

### `validation` Object
- **`semantic`** (`string`): Outcome of differential trace validation:
  - `"PASS"`: Observable traces match between original and recovered scripts.
  - `"CONSERVATIVE"`: Conservative fallback preserved; trace comparison not evaluated.
  - `"NOT_RUN"`: Trace validation was disabled via `--no-semantic-validation`.
  - `"FAIL"`: Observable trace discrepancy detected.

### `reproducibility` Object
- Captures environment parameters (`sha256`, `toolVersion`, `nodeVersion`, `platform`, `options`) necessary to audit and reproduce recovery results deterministically.

### Data Privacy Guarantee
To prevent information leakage across multi-tenant or shared environments, the report **never** exposes:
- Absolute filesystem paths from the host machine.
- Environment variables or system usernames.
- Internal authentication tokens or credentials.
