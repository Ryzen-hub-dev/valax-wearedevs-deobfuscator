# Job Lifecycle & State Machine

## 1. Canonical Job States

The recovery system defines a strict finite state machine for every submitted recovery task:

- `QUEUED`: Job has been accepted by the gateway and is waiting in the queue for an available worker lease.
- `RUNNING`: Job has been leased by an active worker container with an active lease token.
- `COMPLETED`: Job successfully finished, admission tier recorded, and recovered artifacts stored.
- `FAILED`: Job encountered an unrecoverable failure or exceeded maximum retry attempts.
- `CANCELLED`: Job was manually cancelled by the submitting principal prior to or during execution.
- `TIMED_OUT`: Job exceeded execution timeout or worker lease expired without heartbeats.
- `RESOURCE_LIMIT`: Job violated configured memory, CPU, input, or output thresholds.

```
                  +---------+
                  | QUEUED  |
                  +---------+
                   /   |   \
        Lease job /    |    \ Cancel
                 v     |     v
          +---------+  |  +-----------+
          | RUNNING |  |  | CANCELLED |
          +---------+  |  +-----------+
         /   /   \  \  \
Success /   /     \  \  \ Timeout
       v   v       v  v  v
+-----------+  +--------+  +---------------+  +-----------+
| COMPLETED |  | FAILED |  | RESOURCE_LIMIT|  | TIMED_OUT |
+-----------+  +--------+  +---------------+  +-----------+
```

---

## 2. Leasing & Heartbeat Protocol

To support distributed, resilient execution across worker nodes:
1. **Lease Acquisition**: When a worker requests a job (`queue.leaseNextJob(workerId)`), the queue generates a cryptographically random `leaseToken` and assigns an expiration timestamp (`expiresAt = now + leaseDurationMs`).
2. **Heartbeats**: During execution, the worker periodically sends heartbeat updates (`queue.heartbeat(jobId, leaseToken)`), which extend the lease expiration.
3. **Stale Lease Recovery**: If a worker crashes or becomes unresponsive, its lease will expire. On the next queue inspection, the stale lease is reclaimed:
   - If `job.attempts < maxRetries`: The job is reset to `QUEUED` and re-inserted into the front of the queue.
   - If `job.attempts >= maxRetries`: The job transitions to `TIMED_OUT` or `FAILED`.

---

## 3. Idempotency & Concurrency

- **Idempotency Deduplication**: Clients may submit an `idempotencyKey`. If a job with the same key already exists, the gateway returns the existing job without creating duplicates.
- **Principal Concurrency Limiting**: Each principal is restricted to a maximum number of concurrent running jobs (default: 2). Additional submissions remain queued until active jobs finish.
