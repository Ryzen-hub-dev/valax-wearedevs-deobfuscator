/**
 * Repository Manifest Generator (P0-13)
 * Scans the workspace against .gitignore to determine tracked filesToCommit vs ignoredFiles,
 * verifies audits, and writes audit/repository-manifest.json.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REMOTE_URL = 'https://github.com/Ryzen-hub-dev/valax-wearedevs-deobfuscator';

function walkDir(dir) {
  let files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.name === '.git') continue;
    if (entry.isDirectory()) {
      files = files.concat(walkDir(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function isIgnored(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  
  if (norm.startsWith('node_modules/') || norm === 'node_modules') return true;
  if (norm.startsWith('scratch/') || norm === 'scratch') return true;
  if (norm.startsWith('coverage/') || norm === 'coverage') return true;
  if (norm.startsWith('dist/') || norm === 'dist') return true;
  if (norm.startsWith('tmp/') || norm === 'tmp') return true;
  if (norm.startsWith('temp/') || norm === 'temp') return true;
  if (norm.startsWith('tests/temp/') || norm === 'tests/temp') return true;
  if (norm.startsWith('.vscode/') || norm.startsWith('.idea/')) return true;

  if (norm.endsWith('.log')) return true;
  if (norm.endsWith('.tgz')) return true;
  if (norm.endsWith('.DS_Store') || norm.endsWith('Thumbs.db')) return true;

  // Root scratch outputs
  const basename = path.basename(norm);
  if (basename.startsWith('scratch_')) return true;
  if (basename.endsWith('.recovered.lua')) return true;
  if (basename.endsWith('.roundtrip.lua')) return true;
  if (basename.endsWith('.second.lua')) return true;
  if (basename === 'result.lua' || basename === 'report.json' || basename === 'ByIdiotSandWich.report.json') return true;
  if (basename === 'inspect_minimal.js' || basename === 'print_unknowns.js') return true;

  return false;
}

function generateManifest() {
  console.log('=== GENERATING REPOSITORY MANIFEST ===');

  const allFiles = walkDir(ROOT);
  let filesToCommit = 0;
  let ignoredFiles = 0;
  const commitList = [];
  const ignoredList = [];

  for (const f of allFiles) {
    const rel = path.relative(ROOT, f);
    if (isIgnored(rel)) {
      ignoredFiles++;
      ignoredList.push(rel);
    } else {
      filesToCommit++;
      commitList.push(rel);
    }
  }

  // Load audit results
  let cleanCheckoutSimulation = false;
  try {
    const sim = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/fresh-checkout-simulation.json'), 'utf8'));
    cleanCheckoutSimulation = (sim.status === 'CLEAN_CHECKOUT_SIMULATION_PASS');
  } catch (e) {}

  let secretScanPass = false;
  try {
    const hyg = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/repository-hygiene.json'), 'utf8'));
    secretScanPass = (hyg.secretScan && hyg.secretScan.pass === true);
  } catch (e) {}

  let portablePathsPass = false;
  try {
    const port = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/portable-path-audit.json'), 'utf8'));
    portablePathsPass = (port.portable === true);
  } catch (e) {}

  let coreBaselinePass = false;
  try {
    const { CoreBaselineGuard } = require('../packages/worker/src');
    const guard = new CoreBaselineGuard();
    const ver = guard.verify();
    coreBaselinePass = (ver.verified === true && ver.totalChecked === 51);
  } catch (e) {}

  const manifest = {
    releaseVersion: '0.1.0-beta.1',
    coreBaseline: 'CORE_BASELINE_0.1.0-beta.1',
    filesToCommit,
    ignoredFiles,
    workflow: '.github/workflows/ci.yml',
    runtimeGateJob: 'phase2-container-runtime-gate',
    cleanCheckoutSimulation,
    secretScanPass,
    portablePathsPass,
    coreBaselinePass,
    git: {
      remoteUrl: REMOTE_URL,
      branch: 'main'
    },
    generatedAt: new Date().toISOString()
  };

  const outPath = path.join(ROOT, 'audit/repository-manifest.json');
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Manifest written to ${outPath}`);
  console.log('Manifest Content:', JSON.stringify(manifest, null, 2));

  // Write detailed manifest file list
  const manifestDetails = {
    manifest,
    filesToCommitList: commitList.slice(0, 100),
    ignoredFilesList: ignoredList.slice(0, 50)
  };
  fs.writeFileSync(path.join(ROOT, 'audit/repository-files-breakdown.json'), JSON.stringify(manifestDetails, null, 2), 'utf8');

  return manifest;
}

if (require.main === module) {
  generateManifest();
}

module.exports = { generateManifest };
