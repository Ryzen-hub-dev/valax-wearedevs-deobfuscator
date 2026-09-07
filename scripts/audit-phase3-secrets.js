/**
 * Phase 3 Secret & Repository Hygiene Scanner:
 * Scans repository files for exposed API keys, private tokens, passwords, and secrets.
 * Outputs redacted findings to audit/phase3-secret-scan.json.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AUDIT_OUT = path.join(ROOT, 'audit/phase3-secret-scan.json');

const SCAN_TARGETS = [
  'apps',
  'packages/api',
  'packages/gateway',
  'packages/queue',
  'packages/worker',
  'packages/discord',
  '.github/workflows',
  'infra',
  'tests',
  '.env.example'
];

const SECRET_PATTERNS = [
  { name: 'DISCORD_TOKEN', regex: /(?:discord(?:_|-)?token|bot(?:_|-)?token)\s*[:=]\s*['"][a-zA-Z0-9_\-\.]{24,}['"]/i },
  { name: 'GENERIC_PRIVATE_KEY', regex: /-----BEGIN\s+(?:RSA|OPENSSH|EC|DSA)?\s*PRIVATE\s+KEY-----/i },
  { name: 'GITHUB_PERSONAL_ACCESS_TOKEN', regex: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
  { name: 'GENERIC_PASSWORD_ASSIGNMENT', regex: /(?:password|passwd|secret_key)\s*[:=]\s*['"][a-zA-Z0-9!@#$%^&*()_+]{8,}['"]/i }
];

// Exemptions for template/example/test files that deliberately contain placeholder tokens
const EXEMPT_PATTERNS = [
  /NODE_ENV=/,
  /SESSION_SECRET=/,
  /REDIS_URL=redis:\/\//,
  /placeholder/i,
  /example/i,
  /dev-default/
];

function getAllFiles(dirPath, filesList = []) {
  if (!fs.existsSync(dirPath)) return filesList;
  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    filesList.push(dirPath);
    return filesList;
  }

  const entries = fs.readdirSync(dirPath);
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'audit') continue;
    const full = path.join(dirPath, entry);
    if (fs.statSync(full).isDirectory()) {
      getAllFiles(full, filesList);
    } else {
      filesList.push(full);
    }
  }
  return filesList;
}

function runSecretScan() {
  console.log('=== PHASE 3 SECRET & HYGIENE SCANNER ===');
  const findings = [];
  const filesToScan = [];

  for (const target of SCAN_TARGETS) {
    const abs = path.join(ROOT, target);
    getAllFiles(abs, filesToScan);
  }

  // Deduplicate
  const uniqueFiles = [...new Set(filesToScan)];

  for (const file of uniqueFiles) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      // Check if line is exempt
      if (EXEMPT_PATTERNS.some(p => p.test(line))) return;

      for (const pattern of SECRET_PATTERNS) {
        if (pattern.regex.test(line)) {
          findings.push({
            rule: pattern.name,
            file: rel,
            line: idx + 1,
            category: 'POTENTIAL_CREDENTIAL_OR_KEY'
          });
        }
      }
    });
  }

  const pass = findings.length === 0;
  const result = {
    timestamp: new Date().toISOString(),
    status: pass ? 'SECRET_HYGIENE_PASS' : 'SECRET_FINDINGS_DETECTED',
    filesScanned: uniqueFiles.length,
    findingsCount: findings.length,
    findings,
    pass
  };

  fs.mkdirSync(path.dirname(AUDIT_OUT), { recursive: true });
  fs.writeFileSync(AUDIT_OUT, JSON.stringify(result, null, 2), 'utf8');

  console.log(`Scanned ${uniqueFiles.length} files.`);
  console.log(`Findings count: ${findings.length}`);
  console.log(`Audit saved to ${AUDIT_OUT}`);

  if (!pass) {
    console.error('FATAL: Secret scanner found potential leaked credentials:');
    findings.forEach(f => console.error(`  - [${f.rule}] ${f.file}:${f.line} (${f.category})`));
    process.exit(1);
  } else {
    console.log('✔ Clean repository hygiene confirmed. Zero leaked credentials found.');
  }
}

if (require.main === module) {
  runSecretScan();
}

module.exports = { runSecretScan };
