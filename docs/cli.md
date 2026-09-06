# Valax Command Line Interface (CLI) Guide

## 1. Installation & Binary Invocation

Valax CLI can be executed directly via Node.js or npm package links:

```bash
# Global or project invocation
valax-recover input.lua

# Direct execution via npx
npx valax-recover input.lua
```

---

## 2. Command Syntax & Options

```bash
valax-recover <input.lua> [options]
```

### Options Reference

| Flag | Argument | Description | Default |
| :--- | :--- | :--- | :--- |
| `-o, --output` | `<file>` | Path to write recovered Lua output file. | `recovered.lua` |
| `-r, --report` | `<file>` | Path to write diagnostic JSON report. | `report.json` |
| `-s, --stage` | `<auto\|L4\|L5-W>` | Requested target recovery stage. | `auto` |
| `--no-semantic-validation` | *None* | Disables isolated differential trace observation. | Enabled |
| `--json` | *None* | Output machine-readable JSON to stdout only. | Human mode |
| `-v, --version` | *None* | Print tool version and exit. | — |
| `-h, --help` | *None* | Print CLI help documentation. | — |

### Forbidden Bypass Flags
To preserve proof integrity and prevent speculative emission, Valax strictly rejects any correctness bypass parameters:
- `--force-l5w`
- `--ignore-proof-failure`
- `--unsafe-prune`
- `--bypass-gates`

Passing any of these parameters will result in immediate termination with **Exit Code 2 (INVALID_ARGUMENTS)**.

---

## 3. Exit Codes Contract

The Valax CLI returns deterministic exit codes suitable for automated scripting and CI/CD pipelines:

| Exit Code | Identifier | Description |
| :---: | :--- | :--- |
| **0** | `SUCCESS` | Recovery completed successfully (including conservative L4 downgrade). |
| **2** | `INVALID_ARGUMENTS` | Invalid command line arguments, missing file, or prohibited bypass flag. |
| **3** | `PARSE_FAILURE` | Input Lua syntax error or invalid token stream. |
| **4** | `UNRECOGNIZED_FORMAT` | Unsupported obfuscator format or binary bytecode input. |
| **5** | `RECOVERY_INTERNAL_FAILURE` | Internal recovery algorithm exception. |
| **6** | `SEMANTIC_VALIDATION_FAILURE` | Observable trace discrepancy between recovered and original code. |
| **7** | `SAFETY_RESOURCE_LIMIT` | Input size exceeds limit (5 MiB) or execution timed out. |
| **8** | `OUTPUT_WRITE_FAILURE` | Failure to write output code or report to disk. |

> **NOTE ON CONSERVATIVE DOWNGRADE**:
> A conservative fallback to **L4** is **not an error**. When `--stage auto` is requested and an obfuscated script cannot be completely isolated without speculative assumptions, the CLI returns **Exit Code 0** with `actualLevel: "L4"` recorded in the output and report.

---

## 4. stdout & stderr Contracts

### Human Mode (Default)
In human mode, recovery summary information is printed to `stdout`, and warnings/diagnostics are routed to `stderr`:

```text
Input: sample.lua
Protection: WeAreDevs v1.0.0
Recovery Level: L5-W
Residual Dispatcher States: 0
Semantic Validation: PASS
Output: recovered.lua
Report: report.json
```

### Machine-Readable JSON Mode (`--json`)
When `--json` is supplied, `stdout` outputs strictly valid JSON without preamble, progress indicators, or ANSI escape sequences:

```bash
valax-recover sample.lua --json | jq .recovery.actualLevel
```

---

## 5. Windows Usage Examples

```powershell
# Paths with spaces
valax-recover "C:\My Scripts\protected game.lua" --output "C:\My Scripts\clean.lua"

# Relative paths and custom report location
valax-recover .\input.lua -o .\output.lua -r .\audit\report.json

# Unicode filenames
valax-recover "测试_脚本.lua" --json
```
