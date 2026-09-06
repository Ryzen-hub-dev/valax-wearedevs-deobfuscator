# Worker Container Security & Threat Model

## 1. Threat Model & Untrusted Code Execution

Valax accepts untrusted Lua code submitted by arbitrary internet users. Untrusted scripts may contain:
1. Malicious payloads attempting container escapes or host filesystem access.
2. Network scanning, exfiltration, or reverse shells.
3. Path traversal attacks attempting to read host configuration or environment secrets.
4. Denial of service attacks via infinite recursion, memory exhaustion, or fork bombs.

---

## 2. Container Isolation Profile

Every recovery job executed within a worker container runs under the following mandatory security profile:

| Security Control | Parameter / Directive | Defense Objective |
| :--- | :--- | :--- |
| **Network Isolation** | `--network none` | Completely prevents inbound and outbound network connectivity; blocks data exfiltration and external C2 calls. |
| **Filesystem Immutability** | `--read-only` | Root filesystem `/` cannot be written to or modified by any process. |
| **Privilege Elimination** | `--user 1000:1000` | Drops root user identity immediately to non-privileged user `valax`. |
| **Capability Dropping** | `--cap-drop ALL` | Revokes all Linux POSIX capabilities (no `CAP_SYS_ADMIN`, `CAP_NET_RAW`, etc.). |
| **Privilege Escalation Block**| `--security-opt=no-new-privileges:true` | Prevents `setuid` binaries or privilege transitions. |
| **Memory Capping** | `--memory 512m --memory-swap 512m` | Restricts total physical and swap memory to 512MB to prevent host memory exhaustion. |
| **CPU Capping** | `--cpus 1.0` | Prevents worker from monopolizing host CPU cores. |
| **Process Capping** | `--pids-limit 128` | Precludes fork-bomb style exhaustion of kernel PID tables. |
| **Ephemeral Memory-Only Mounts** | `--tmpfs /work:rw,noexec,nosuid,size=64m` | Provides temporary workspace in RAM with execution and suid bits disabled. |
| **Host Directory Isolation** | **Zero host volume mounts** | The host filesystem is never mounted into the worker container. |

---

## 3. Defense-in-Depth & Integrity Guarantees

1. **Input SHA-256 Digest Verification**: Prior to executing the pipeline, the worker verifies that the input payload matches the SHA-256 hash computed at the gateway ingress.
2. **Output Size Clamping**: If recovered code exceeds the maximum permitted output size (default 2MB), the worker halts with `OUTPUT_LIMIT_EXCEEDED` to prevent disk or memory denial of service.
3. **Core Baseline Verification**: The `CoreBaselineGuard` validates the hash integrity of the frozen core recovery algorithms before job execution.
