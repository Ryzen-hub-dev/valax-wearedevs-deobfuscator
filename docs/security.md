# Security & Isolation Model

## 1. Untrusted Code Notice

Obfuscated, protected, and recovered Lua scripts are treated as **untrusted, arbitrary code**.

Under no circumstances does Valax execute untrusted Lua directly in the primary Node.js process, API server, or bot runner. Dynamic trace observation and differential semantic validation are mediated through an isolated runner (`@valax/sandbox`).

---

## 2. Isolated Process Runner Guarantees

The `IsolatedRunner` enforces the following boundaries on child Lua processes:

### A. Working Directory Isolation
- Every invocation generates a unique, isolated temporary directory (e.g. `%TEMP%/valax-sandbox-<uuid>/`).
- Child process `cwd` is locked to this ephemeral directory.
- The host project workspace, repository root, and source trees are inaccessible as the current working directory.
- Upon completion, timeout, or abnormal termination, the temporary directory is recursively deleted.

### B. Environment Variable Sanitization
- The parent process environment (`process.env`) is never inherited by child processes.
- An allowlist containing only essential system variables is supplied:
  - `PATH`, `PATHEXT`, `SYSTEMROOT`, `WINDIR`, `TEMP`, `TMP`, `COMSPEC`, `NODE_ENV`
- All secrets, API keys, tokens, Discord bot tokens, database credentials, and personal paths are stripped.

### C. Wall-Clock Timeout Enforcement
- Default timeout is **5000 milliseconds** (5.0 seconds).
- If the child process enters an infinite loop or fails to terminate within the timeout window, the runner terminates the process immediately with `SIGKILL` and records a `TIMEOUT` status.

### D. Output Buffer Limit Enforcement
- Maximum output buffer limit is **1 MiB** for both stdout and stderr.
- Infinite print loops or output flooding terminate execution immediately with `OUTPUT_LIMIT_EXCEEDED` to prevent memory exhaustion and DoS attacks.

---

## 3. Platform Capabilities & Honest Disclosure

Valax honestly discloses its isolation capabilities based on host OS architecture:

| Security Dimension | Local Windows CLI Capability | Status |
| :--- | :--- | :--- |
| **Filesystem Isolation** | Temporary working directory per execution | `isolated-temp-cwd` |
| **Environment Sanitization** | Strict allowlist of safe system keys | `allowlist` |
| **Timeout Enforcement** | Wall-clock timer with hard process termination | `process-kill` |
| **Output Buffer Bounding** | 1 MiB max buffer clamp | `max-buffer-kill` |
| **Network Isolation** | Unenforced on standard Windows child process | `unavailable` |
| **Memory Isolation** | Unenforced on standard Windows child process | `unavailable` |

> **IMPORTANT**:
> Bare Windows `child_process.spawnSync` does **not** provide kernel-level network namespace virtualization or hard memory limits without Windows Server Containers or Linux cgroups.
> 
> For public hosted deployments (Web services, public Discord bots, multi-tenant APIs), the system must be deployed inside an OS-level container (such as Docker, gVisor, or restricted Firecracker microVMs) to guarantee network and memory isolation.
