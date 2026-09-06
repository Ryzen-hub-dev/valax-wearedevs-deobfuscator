/**
 * CI Handoff Audit Script:
 * Performs comprehensive audits for repository hygiene, portable paths,
 * Linux case sensitivity, line-ending / core baseline hash stability,
 * Docker build context, and repository manifest generation.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

// Helper to recursively list files
function walkDir(dir, filterFn = null) {
  let files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (filterFn && !filterFn(full, true)) continue;
      files = files.concat(walkDir(full, filterFn));
    } else {
      if (filterFn && !filterFn(full, false)) continue;
      files.push(full);
    }
  }
  return files;
}

// 1. P0-1: Repository Hygiene Audit
function auditRepositoryHygiene() {
  console.log('[P0-1] Auditing Repository Hygiene...');
  const secretPatterns = [
    { name: 'Discord Token', regex: /(?:mfa\.[a-z0-9_-]{20,}|[a-z0-9_-]{24}\.[a-z0-9_-]{6}\.[a-z0-9_-]{27})/i },
    { name: 'GitHub Token', regex: /gh[pousr]_[0-9a-zA-Z]{36}/ },
    { name: 'Generic API Key / Secret', regex: /(?:api_key|apikey|secret_key|private_key|client_secret)\s*[:=]\s*["'][a-zA-Z0-9_\-]{16,}["']/i },
    { name: 'Private Key Header', regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
    { name: 'Redis with Auth', regex: /redis:\/\/[^@]+:[^@]+@/i },
    { name: 'Database URL with Auth', regex: /postgres:\/\/[^@]+:[^@]+@|mysql:\/\/[^@]+:[^@]+@/i }
  ];

  const bannedFilenames = [
    /\.env$/i,
    /\.env\.(?!example$)/i,
    /credentials\.json$/i,
    /.*\.pem$/i,
    /.*\.key$/i
  ];

  const absolutePatterns = [
    /C:\\Users\\ksjz1/i,
    /\.gemini\\antigravity/i,
    /file:\/\/\//i
  ];

  const findings = [];
  const largeFiles = [];
  const excludedGeneratedPaths = [];
  const absolutePathFindings = [];

  // Exclude node_modules, .git, scratch
  const allFiles = walkDir(ROOT, (p, isDir) => {
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    if (rel === 'node_modules' || rel.startsWith('node_modules/')) return false;
    if (rel === '.git' || rel.startsWith('.git/')) return false;
    return true;
  });

  for (const file of allFiles) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const stat = fs.statSync(file);

    // Large files (> 500KB)
    if (stat.size > 500 * 1024) {
      largeFiles.push({
        path: rel,
        sizeBytes: stat.size,
        sizeFormatted: (stat.size / (1024 * 1024)).toFixed(2) + ' MB'
      });
    }

    // Check banned filenames
    for (const b of bannedFilenames) {
      if (b.test(path.basename(file))) {
        findings.push({
          file: rel,
          line: 1,
          type: 'Banned Credential Filename',
          fingerprint: path.basename(file)
        });
      }
    }

    // Generated / scratch paths check
    if (rel.startsWith('scratch') || rel.includes('/scratch/') || rel.endsWith('.recovered.lua') || rel.endsWith('.roundtrip.lua') || rel.endsWith('.second.lua') || (rel.startsWith('scratch_') && (rel.endsWith('.json') || rel.endsWith('.txt')))) {
      excludedGeneratedPaths.push(rel);
    }

    // Scan text file contents (skip huge binaries or lua files > 1MB)
    if (stat.size < 1024 * 1024 && !file.endsWith('.png') && !file.endsWith('.jpg') && !file.endsWith('.ico')) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');

        lines.forEach((line, idx) => {
          // Secret scan
          for (const sp of secretPatterns) {
            const match = line.match(sp.regex);
            if (match) {
              const matchedStr = match[0];
              const redacted = matchedStr.slice(0, 3) + '***' + matchedStr.slice(-3);
              findings.push({
                file: rel,
                line: idx + 1,
                type: sp.name,
                fingerprint: redacted
              });
            }
          }

          // Absolute path scan (skip this audit script itself, scratch scripts, docs/walkthrough, and comments)
          if (!rel.includes('audit-ci-handoff') && !rel.startsWith('scratch/') && !rel.endsWith('.md')) {
            for (const ap of absolutePatterns) {
              if (ap.test(line)) {
                absolutePathFindings.push({
                  file: rel,
                  line: idx + 1,
                  sample: line.trim().substring(0, 100)
                });
              }
            }
          }
        });
      } catch (err) {
        // Skip unreadable files
      }
    }
  }

  const result = {
    timestamp: new Date().toISOString(),
    secretScan: {
      pass: findings.length === 0,
      findings
    },
    largeFiles,
    excludedGeneratedPaths,
    absolutePathFindings: {
      pass: absolutePathFindings.length === 0,
      findings: absolutePathFindings
    }
  };

  const outPath = path.join(ROOT, 'audit/repository-hygiene.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`[P0-1] Repository hygiene audit written to ${outPath}. Secrets pass: ${result.secretScan.pass}`);
  return result;
}

// 2. P0-6: Absolute Local Paths in Source & Tests
function auditPortablePaths() {
  console.log('[P0-6] Auditing Portable Paths in Source & Tests...');
  const targets = ['packages', 'tests', 'scripts', 'infra', '.github'];
  const forbiddenPatterns = [
    /C:\\Users\\ksjz1/i,
    /C:\\Users\\/i,
    /Downloads\\deobfuscator/i,
    /\.gemini/i,
    /antigravity/i,
    /brain\\/i,
    /file:\/\/\//i
  ];

  const findings = [];
  for (const target of targets) {
    const targetDir = path.join(ROOT, target);
    if (!fs.existsSync(targetDir)) continue;
    const files = walkDir(targetDir);
    for (const file of files) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      if (rel.endsWith('.log') || rel.endsWith('.png') || rel.includes('audit-ci-handoff')) continue;
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        for (const pat of forbiddenPatterns) {
          if (pat.test(line)) {
            findings.push({
              file: rel,
              line: idx + 1,
              pattern: pat.toString(),
              snippet: line.trim()
            });
          }
        }
      });
    }
  }

  const result = {
    timestamp: new Date().toISOString(),
    portable: findings.length === 0,
    totalScannedDirectories: targets,
    findingsCount: findings.length,
    findings
  };

  const outPath = path.join(ROOT, 'audit/portable-path-audit.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`[P0-6] Portable path audit written to ${outPath}. Pass: ${result.portable}`);
  return result;
}

// 3. P0-7: Linux Path & Case Sensitivity Audit
function auditLinuxCasePortability() {
  console.log('[P0-7] Auditing Linux Case Portability...');
  const targets = ['packages', 'tests', 'scripts'];
  const requireRegex = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  const issues = [];
  let totalChecked = 0;

  for (const target of targets) {
    const targetDir = path.join(ROOT, target);
    if (!fs.existsSync(targetDir)) continue;
    const files = walkDir(targetDir, (p, isDir) => !p.includes('node_modules'));
    for (const file of files) {
      if (!file.endsWith('.js') && !file.endsWith('.json')) continue;
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      const content = fs.readFileSync(file, 'utf8');
      let match;
      while ((match = requireRegex.exec(content)) !== null) {
        totalChecked++;
        const reqPath = match[1];
        const dir = path.dirname(file);
        
        // Resolve full target path
        let resolved = path.resolve(dir, reqPath);
        if (!fs.existsSync(resolved)) {
          if (fs.existsSync(resolved + '.js')) resolved = resolved + '.js';
          else if (fs.existsSync(resolved + '.json')) resolved = resolved + '.json';
          else if (fs.existsSync(path.join(resolved, 'index.js'))) resolved = path.join(resolved, 'index.js');
        }

        if (!fs.existsSync(resolved)) {
          issues.push({
            sourceFile: rel,
            importPath: reqPath,
            error: 'Target file does not exist'
          });
          continue;
        }

        // Verify case sensitivity against physical directory entry
        const segments = path.relative(ROOT, resolved).split(path.sep);
        let curr = ROOT;
        for (const seg of segments) {
          const entries = fs.readdirSync(curr);
          if (!entries.includes(seg)) {
            // Case mismatch found!
            const matchedInsensitive = entries.find(e => e.toLowerCase() === seg.toLowerCase());
            issues.push({
              sourceFile: rel,
              importPath: reqPath,
              expectedCase: matchedInsensitive,
              actualCase: seg,
              resolvedPath: path.relative(ROOT, resolved).replace(/\\/g, '/')
            });
            break;
          }
          curr = path.join(curr, seg);
        }
      }
    }
  }

  const result = {
    timestamp: new Date().toISOString(),
    pass: issues.length === 0,
    totalRequiresChecked: totalChecked,
    mismatchesCount: issues.length,
    mismatches: issues
  };

  const outPath = path.join(ROOT, 'audit/linux-case-portability.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`[P0-7] Linux case portability written to ${outPath}. Pass: ${result.pass}`);
  return result;
}

// 4. P0-8 & P0-10: Line Endings & Core Baseline Hash Stability
function auditCoreBaselineAndEol() {
  console.log('[P0-8 & P0-10] Auditing Core Baseline and Line Endings...');
  const hashesPath = path.join(ROOT, 'audit/core-baseline-hashes.json');
  const baseline = JSON.parse(fs.readFileSync(hashesPath, 'utf8'));
  const hashes = baseline.hashes || baseline.fileHashes || {};

  const fileDetails = [];
  let crlfFiles = 0;
  let lfFiles = 0;
  let mismatches = 0;

  for (const [relPath, expectedHash] of Object.entries(hashes)) {
    const fullPath = path.join(ROOT, relPath);
    if (!fs.existsSync(fullPath)) {
      mismatches++;
      fileDetails.push({ relPath, status: 'MISSING', expectedHash });
      continue;
    }

    const buf = fs.readFileSync(fullPath);
    const actualHash = crypto.createHash('sha256').update(buf).digest('hex');
    const hashMatch = (actualHash === expectedHash);
    if (!hashMatch) mismatches++;

    // Count CRLF vs LF
    let crlf = 0;
    let lf = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) {
        if (i > 0 && buf[i - 1] === 0x0d) crlf++;
        else lf++;
      }
    }

    const eolType = crlf > 0 && lf === 0 ? 'CRLF' : lf > 0 && crlf === 0 ? 'LF' : crlf > 0 && lf > 0 ? 'MIXED' : 'NO_NEWLINES';
    if (eolType === 'CRLF') crlfFiles++;
    else if (eolType === 'LF') lfFiles++;

    // Calculate LF-normalized hash (if CRLF converted to LF)
    const normalizedBuf = Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    const normalizedHash = crypto.createHash('sha256').update(normalizedBuf).digest('hex');

    fileDetails.push({
      relPath,
      eolType,
      hashMatch,
      expectedHash,
      actualHash,
      normalizedHash,
      hashDiffersOnLfConversion: actualHash !== normalizedHash
    });
  }

  const result = {
    baselineTag: baseline.baselineTag,
    totalFiles: Object.keys(hashes).length,
    crlfFiles,
    lfFiles,
    mismatches,
    allMatchCurrentDisk: mismatches === 0,
    fileDetails
  };

  console.log(`[P0-10] Core baseline checked: ${result.totalFiles} files. CRLF: ${crlfFiles}, LF: ${lfFiles}, Current Mismatches: ${mismatches}`);
  return result;
}

// 5. P0-9: Docker Build Context
function auditDockerBuildContext() {
  console.log('[P0-9] Auditing Docker Build Context...');
  const dockerignorePath = path.join(ROOT, '.dockerignore');
  let rules = [];
  if (fs.existsSync(dockerignorePath)) {
    rules = fs.readFileSync(dockerignorePath, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
  }

  const result = {
    timestamp: new Date().toISOString(),
    dockerignorePresent: fs.existsSync(dockerignorePath),
    totalRules: rules.length,
    rules,
    criticalExclusionsVerified: {
      git: rules.includes('.git'),
      node_modules: rules.includes('node_modules'),
      env: rules.includes('.env'),
      scratch: rules.includes('scratch'),
      logs: rules.includes('*.log')
    },
    requiredInclusionsPresent: {
      packageJson: fs.existsSync(path.join(ROOT, 'package.json')),
      packagesCore: fs.existsSync(path.join(ROOT, 'packages/core/src/index.js')),
      packagesWorker: fs.existsSync(path.join(ROOT, 'packages/worker/src/index.js')),
      coreHashes: fs.existsSync(path.join(ROOT, 'audit/core-baseline-hashes.json'))
    }
  };

  const outPath = path.join(ROOT, 'audit/docker-build-context.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(`[P0-9] Docker build context written to ${outPath}.`);
  return result;
}

// 6. P0-13: Repository Manifest
function generateRepositoryManifest(hygiene, portablePaths, coreEol) {
  console.log('[P0-13] Generating Repository Manifest...');
  const allFiles = walkDir(ROOT, (p) => {
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    if (rel === 'node_modules' || rel.startsWith('node_modules/')) return false;
    if (rel === '.git' || rel.startsWith('.git/')) return false;
    return true;
  });

  let filesToCommit = 0;
  let ignoredFiles = 0;

  for (const f of allFiles) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    const base = path.basename(rel);
    const ignored = rel.startsWith('scratch') ||
      rel.startsWith('tmp') ||
      rel.startsWith('temp') ||
      rel.startsWith('coverage') ||
      rel.startsWith('dist') ||
      rel.startsWith('tests/temp') ||
      rel.startsWith('.vscode') ||
      rel.startsWith('.idea') ||
      rel.endsWith('.log') ||
      rel.endsWith('.tgz') ||
      base.startsWith('scratch_') ||
      base.endsWith('.recovered.lua') ||
      base.endsWith('.roundtrip.lua') ||
      base.endsWith('.second.lua') ||
      base === 'result.lua' ||
      base === 'report.json' ||
      base === 'ByIdiotSandWich.report.json' ||
      base === 'inspect_minimal.js' ||
      base === 'print_unknowns.js';

    if (ignored) ignoredFiles++;
    else filesToCommit++;
  }

  let cleanCheckoutSimulation = false;
  try {
    const sim = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/fresh-checkout-simulation.json'), 'utf8'));
    cleanCheckoutSimulation = (sim.status === 'CLEAN_CHECKOUT_SIMULATION_PASS');
  } catch (e) {}

  const manifest = {
    releaseVersion: '0.1.0-beta.1',
    coreBaseline: 'CORE_BASELINE_0.1.0-beta.1',
    filesToCommit,
    ignoredFiles,
    workflow: '.github/workflows/ci.yml',
    runtimeGateJob: 'phase2-container-runtime-gate',
    cleanCheckoutSimulation,
    secretScanPass: hygiene.secretScan.pass,
    portablePathsPass: portablePaths.portable,
    coreBaselinePass: coreEol.allMatchCurrentDisk
  };

  const outPath = path.join(ROOT, 'audit/repository-manifest.json');
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`[P0-13] Repository manifest written to ${outPath}`);
  return manifest;
}

function runAll() {
  const hygiene = auditRepositoryHygiene();
  const portablePaths = auditPortablePaths();
  const linuxCase = auditLinuxCasePortability();
  const coreEol = auditCoreBaselineAndEol();
  const dockerContext = auditDockerBuildContext();
  const manifest = generateRepositoryManifest(hygiene, portablePaths, coreEol);

  return {
    hygiene,
    portablePaths,
    linuxCase,
    coreEol,
    dockerContext,
    manifest
  };
}

if (require.main === module) {
  const res = runAll();
  console.log('CI Handoff Audit Complete. Summary:', {
    secretScanPass: res.hygiene.secretScan.pass,
    portablePathsPass: res.portablePaths.portable,
    linuxCasePass: res.linuxCase.pass,
    coreBaselineAllMatch: res.coreEol.allMatchCurrentDisk,
    crlfFiles: res.coreEol.crlfFiles,
    lfFiles: res.coreEol.lfFiles,
    filesToCommit: res.manifest.filesToCommit,
    ignoredFiles: res.manifest.ignoredFiles
  });
}

module.exports = { runAll };
