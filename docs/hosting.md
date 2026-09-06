# Valax Recovery Hosting & Service Integration Guide

## 1. Multi-Tenant Deployment Modes

Valax Recovery can be hosted behind multiple clients:
- **Web Frontend**: Web users upload obfuscated scripts via an HTTP API or WebSocket interface.
- **Discord Bot**: A Discord bot receives file attachments or code blocks and forwards requests to the Gateway.
- **Developer API**: Authenticated programmatic consumers submit automation pipelines.

---

## 2. API Gateway Endpoints & Integration

### Submitting a Recovery Job
```javascript
const { RecoveryGateway } = require('@valax/gateway');
const gateway = new RecoveryGateway();

const submission = await gateway.submitJob({
  principalId: 'discord-user-12345',
  source: 'print("hello")',
  filename: 'obfuscated.lua',
  options: { requestedStage: 'auto' },
  limits: { timeoutMs: 30000 }
});
console.log(submission.jobId); // 'job-...'
```

### Polling / Retrieving Job Status
```javascript
const job = gateway.getJob(submission.jobId, 'discord-user-12345');
console.log(job.state); // 'QUEUED', 'RUNNING', or 'COMPLETED'
```

### Retrieving Artifacts
Artifact access is strictly authorized by principal ID:
```javascript
// Retrieve recovered code
const code = gateway.getArtifact(submission.jobId, 'recoveredCode', 'discord-user-12345');

// Retrieve diagnostic report
const report = gateway.getArtifact(submission.jobId, 'report', 'discord-user-12345');
```

---

## 3. Ephemeral Retention & Privacy

1. **Source Code Release Policy**: Input temporary files are deleted after job completion/failure. Application-level references to source payloads are released. The service does not intentionally persist source beyond configured retention. Input source is not retained as a long-lived artifact in the artifact store. Note: JavaScript runtime/OS memory reclamation does not provide a guaranteed cryptographic secure erase of every in-memory copy.
2. **24-Hour Retention Window**: Recovered code and diagnostic reports are retained for 24 hours to allow user download. After 24 hours, artifacts are automatically purged by garbage collection.
3. **Storage Quotas**:
   - Recovered Code: Max 5 MB
   - Diagnostic Reports: Max 2 MB
   - Execution Logs: Max 1 MB

---

## 4. Health & Monitoring

- **Liveness Probe**: `gateway.getLiveness()` returns `{ status: 'OK' }`.
- **Readiness Probe**: `gateway.getReadiness()` verifies the frozen core baseline SHA-256 integrity and checks queue availability.
- **Metrics**: `gateway.metrics.getSnapshot()` returns real-time counters and durations without leaking sensitive user data.
