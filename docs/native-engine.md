# Native Recovery Engine Architecture

## Runtime split

Valax now treats Vercel as the authenticated gateway, not as the long-running recovery machine.

- Discord Gateway Bot: access control, cooldowns, uploads, and ephemeral responses.
- Vercel API: authentication, source limits, native-compatible preflight, and light/synchronous recovery.
- Native Worker: containerized C++/Node hybrid for large jobs, strict CPU/memory limits, and future full-native recovery passes.
- Queue and Artifact Store: asynchronous job ownership, retries, cancellation, and short-lived output delivery.

This boundary prevents a large script from killing the public API process and lets the native engine evolve without changing the Discord command contract.

## Native migration milestones

### Milestone 1 — shipped

- C++20 `valax-native` executable.
- O(n) source preflight with bounded extra memory.
- Token, byte, nesting, and line-shape metrics.
- Adaptive recovery-tier admission in both the Vercel API and worker.
- Multi-stage Docker build and Linux CI compilation/test gate.

### Milestone 2

- Compact token buffer with source spans.
- Lua 5.1 and Luau grammar coverage matching the current JavaScript parser.
- Arena-backed AST with stable node IDs.
- Differential parser tests against the existing 103-program corpus.

### Milestone 3

- Native constant folding and string-pool decoding.
- WeAreDevs adapter and alias recovery.
- Binary dispatcher discovery and CFG construction.
- Memory and wall-clock benchmarks recorded per fixture.

### Milestone 4

- Native closure reconstruction, proof generation, and Lua emission.
- JavaScript engine retained as a differential oracle until output parity is proven.
- Large jobs routed exclusively to the persistent native worker.

## Admission policy

The public API requests L5 by default. Preflight may cap the admitted tier:

| Profile | Maximum hosted tier |
| --- | --- |
| Up to 320 KB, 100k tokens, depth 350 | L5 |
| Up to 640 KB, 190k tokens, depth 1000 | L4 |
| Up to 1.2 MB, 350k tokens | L3 |
| Above those thresholds, within the 2 MB request limit | L2 |

The result report records the requested, admitted, and executed stages. A cap is explicit and never represented as a full L5 recovery.
