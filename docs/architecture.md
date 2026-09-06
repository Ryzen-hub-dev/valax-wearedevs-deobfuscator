# Valax Recovery Architecture (Phase 2 Hosted Infrastructure)

## 1. Overview & Service Boundary

Valax Recovery operates as a decoupled, multi-tiered service designed to safely execute untrusted Lua/Luau deobfuscation and structural recovery requests originating from public web interfaces, Discord bots, or developer HTTP APIs.

```
       +---------------------------------------------+
       |   Public Ingress (Web / Discord / API)      |
       +---------------------------------------------+
                              |
                              v [Principal Auth, Rate Limiting, Input Validation]
       +---------------------------------------------+
       |             Recovery Gateway                |
       |  - Rate Limiter (Token Bucket / Window)     |
       |  - Artifact Store (Ephemeral, 24h TTL)      |
       |  - Metrics Instrumentation                  |
       +---------------------------------------------+
                              |
                              v [Idempotent Enqueue]
       +---------------------------------------------+
       |               Job Queue                     |
       |  - In-Memory / Distributed Scheduler        |
       |  - Lease Tokens & Worker Heartbeats         |
       |  - Stale Lease Recovery & Re-enqueuing      |
       +---------------------------------------------+
                              |
                              v [Worker Lease, JSON IPC]
       +---------------------------------------------+
       |         Isolated Container Worker           |
       |  - Network Isolation (--network none)       |
       |  - Read-Only Root Filesystem                |
       |  - Non-Root User (UID 1000:1000)            |
       |  - No-New-Privileges, Dropped Capabilities  |
       |  - Strict Resource & Time Limits            |
       +---------------------------------------------+
                              |
                              v [Strict In-Process Pipeline]
       +---------------------------------------------+
       |        Frozen Core Recovery Engine          |
       |  - FinalAdmissionGate (Canonical Arbiter)   |
       |  - CFG Reconstruction & Transforms          |
       |  - Baseline Integrity Guard (SHA-256)       |
       +---------------------------------------------+
```

---

## 2. Core Isolation & Frozen Baseline

The core recovery engine (`packages/core`) is strictly frozen under `CORE_BASELINE_0.1.0-beta.1_FROZEN`. At worker startup, the `CoreBaselineGuard` verifies the cryptographic hash of all 51 core source files against `audit/core-baseline-hashes.json`. If any tampering or corruption is detected, the worker refuses to start with `CORE_BASELINE_VIOLATION`.

All admission decisions are solely decided by `FinalAdmissionGate.evaluate()`. Downstream workers and gateways cannot mutate admission rules or elevate admission tiers.

---

## 3. Communication Protocol

The Gateway and Workers communicate using a versioned JSON IPC protocol (`WorkerProtocol` Schema Version 1):
- **JobRequest**: Specifies `schemaVersion`, `jobId`, `idempotencyKey`, input metadata (`filename`, `sha256`, `bytes`, `source`), `options`, and resource `limits`.
- **JobResponse**: Standardized response structure containing `schemaVersion`, `jobId`, `status`, `admission` tier and diagnostics, execution `metrics`, and output `artifacts` hashes.
