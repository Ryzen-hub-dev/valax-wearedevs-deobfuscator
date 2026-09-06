# Valax Source Recovery (`0.1.0-beta.1`)

Valax Source Recovery is an evidence-based static recovery engine for supported WeAreDevs-protected Lua/Luau programs.

Recovery is reported by level. Programs for which complete static reconstruction can be established may reach **L5-W**. Programs containing unsupported or incompletely proven structures are conservatively retained at **L4/L4.5** rather than being rewritten speculatively.

---

## Key Guarantees

1. **Evidence-Backed Static Recovery**:
   - Zero hardcoded fixture literals, names, state IDs, or branch assumptions.
   - Zero speculative synthesis: code is emitted solely from verified static IR.
2. **Zero Silent Corruption**:
   - Automated differential trace verification ensures semantics are strictly preserved.
3. **Isolated Process Runner**:
   - Untrusted Lua programs are executed in isolated, resource-bounded runner environments (`@valax/sandbox`).
4. **Deterministic Conservative Bounding**:
   - Unsupported or open-context obfuscations fall back safely to L4 without crashing or guessing.

---

## Architecture & Workspaces

The engine is structured as a modular monorepo:

- **`@valax/core`** ([`packages/core/`](file:///c:/Users/ksjz1/Downloads/deobfuscator/packages/core)):
  Core AST parser, constant evaluator, CFG builder, VM lifter, environment graph, semantic graph completeness verifiers, and semantic AST emitter.
- **`@valax/sandbox`** ([`packages/sandbox/`](file:///c:/Users/ksjz1/Downloads/deobfuscator/packages/sandbox)):
  Resource-bounded isolated runner enforcing wall-clock timeouts, output buffer clamps, temporary cwd isolation, and environment sanitization.
- **`@valax/cli`** ([`packages/cli/`](file:///c:/Users/ksjz1/Downloads/deobfuscator/packages/cli)):
  Command-line interface with machine-readable JSON mode, exit code contracts, and input validation.

---

## Quick Start

### Installation

```bash
npm install
```

### CLI Usage

```bash
# Recover a protected file
npx valax-recover input.lua

# Custom output and report paths
npx valax-recover input.lua --output clean.lua --report audit.json

# Machine-readable JSON output
npx valax-recover input.lua --json
```

---

## Verification & Testing

Valax includes a comprehensive automated test suite enforcing regression and safety gates:

```bash
# Run complete master test suite (unit, integration, regression, sandbox, CLI)
npm test

# Run 10/10 closed corpus regression gate
node scripts/validate-l5w-closed.js

# Run structural anti-hardcoding audit
node scripts/audit-structural-hardcoding.js

# Run 25-sample blind genuine protected corpus
node scripts/build-blind-corpus.js
```

---

## Documentation

- [Recovery Levels Architecture](docs/recovery-levels.md)
- [Security & Isolation Model](docs/security.md)
- [Report Schema Specification](docs/report-schema.md)
- [CLI Reference Guide](docs/cli.md)

---

## License

MIT
