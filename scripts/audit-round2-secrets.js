/**
 * Secret, Token & Log Canary Hygiene Scanner for Phase 3 Round 2.
 * 
 * Verifies that zero live secrets, tokens, private keys, or canary values
 * are committed into repository files or emitted into logs.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const AUDIT_OUTPUT = path.resolve(__dirname, '../audit/phase3-round2-secret-scan.json');

const SECRET_PATTERNS = [
  { name: 'DISCORD_BOT_TOKEN_CANARY', pattern: /DISCORD_BOT_TOKEN_CANARY_[a-zA-Z0-9_-]+/ },
  { name: 'DISCORD_ACCESS_TOKEN_CANARY', pattern: /DISCORD_ACCESS_TOKEN_CANARY_[a-zA-Z0-9_-]+/ },
  { name: 'DISCORD_REFRESH_TOKEN_CANARY', pattern: /DISCORD_REFRESH_TOKEN_CANARY_[a-zA-Z0-9_-]+/ },
  { name: 'SESSION_SECRET_CANARY', pattern: /SESSION_SECRET_CANARY_[a-zA-Z0-9_-]+/ },
  { name: 'LIVE_DISCORD_BOT_TOKEN', pattern: /["'][MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}["']/ },
  { name: 'LIVE_DISCORD_CLIENT_SECRET', pattern: /DISCORD_CLIENT_SECRET\s*=\s*[a-zA-Z0-9]{32}/ },
  { name: 'RAW_PRIVATE_KEY', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ }
];

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'audit'
]);

function redactSecret(str) {
  if (!str || str.length <= 8) return '***';
  return str.substring(0, 4) + '***' + str.substring(str.length - 4);
}

function scanDir(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (IGNORED_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      scanDir(full, fileList);
    } else if (e.isFile()) {
      // Exclude binary / image files and self
      if (!/\.(png|jpg|zip|tar|gz|lock)$/i.test(e.name) && full !== __filename) {
        fileList.push(full);
      }
    }
  }
  return fileList;
}

function runSecretScan() {
  console.log('=== Running Phase 3 Round 2 Secret & Token Scanner ===');

  const files = scanDir(ROOT_DIR);
  const findings = [];
  let filesScanned = 0;

  for (const file of files) {
    filesScanned++;
    const relPath = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf8');

    for (const { name, pattern } of SECRET_PATTERNS) {
      const match = pattern.exec(content);
      if (match) {
        // Exclude test fixture definitions where canary patterns are explicitly defined
        if (relPath.includes('test') && !relPath.includes('log')) {
          continue;
        }
        findings.push({
          file: relPath,
          patternName: name,
          matchedSnippet: redactSecret(match[0])
        });
      }
    }
  }

  console.log(`Scanned ${filesScanned} files. Secret findings: ${findings.length}`);

  const auditData = {
    timestamp: new Date().toISOString(),
    filesScanned,
    pass: findings.length === 0,
    findings
  };

  fs.mkdirSync(path.dirname(AUDIT_OUTPUT), { recursive: true });
  fs.writeFileSync(AUDIT_OUTPUT, JSON.stringify(auditData, null, 2) + '\n');
  console.log(`Wrote secret scan audit: ${AUDIT_OUTPUT}`);

  if (findings.length > 0) {
    console.error('SECRET SCAN FAILURE: Leaked secrets or tokens detected:');
    console.error(JSON.stringify(findings, null, 2));
    process.exit(1);
  }

  console.log('Secret scan PASSED: 0 leaked secrets or tokens detected across codebase.');
}

if (require.main === module) {
  runSecretScan();
}

module.exports = {
  runSecretScan
};
