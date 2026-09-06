/**
 * Git Preparation & Repository Manifest Script (P0-13 & Optional Git Init)
 * Initializes local repository, attaches remote, validates git status,
 * counts tracked vs ignored files, and generates audit/repository-manifest.json.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REMOTE_URL = 'https://github.com/Ryzen-hub-dev/valax-wearedevs-deobfuscator';

function runCmd(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (err) {
    return err.stdout ? err.stdout.toString().trim() : err.message;
  }
}

function prepareGitAndManifest() {
  console.log('=== PREPARING GIT REPOSITORY & MANIFEST ===');

  // 1. Git version
  const gitVer = runCmd('git --version');
  console.log('Git version:', gitVer);

  // 2. Git init
  const initOut = runCmd('git init');
  console.log('Git init:', initOut);

  // 3. Set or check remote
  const remotes = runCmd('git remote -v');
  if (!remotes.includes('origin')) {
    runCmd(`git remote add origin ${REMOTE_URL}`);
    console.log(`Attached remote origin: ${REMOTE_URL}`);
  } else {
    console.log('Remote origin already configured:', remotes);
  }

  // 4. Git status
  const statusShort = runCmd('git status --short');
  console.log('\n--- GIT STATUS (SHORT) ---');
  console.log(statusShort.slice(0, 1000) + (statusShort.length > 1000 ? '\n... (truncated)' : ''));

  // 5. Count files to commit vs ignored
  const statusLines = statusShort.split('\n').map(l => l.trim()).filter(Boolean);
  const filesToCommit = statusLines.length;

  const ignoredOutput = runCmd('git status --ignored -s');
  const ignoredLines = ignoredOutput.split('\n').map(l => l.trim()).filter(l => l.startsWith('!!'));
  const ignoredFiles = ignoredLines.length;

  console.log(`Files to commit (untracked/staged): ${filesToCommit}`);
  console.log(`Ignored files (matching .gitignore): ${ignoredFiles}`);

  // 6. Verify core baseline pass & simulation pass
  let cleanSimulationPass = false;
  try {
    const sim = JSON.parse(fs.readFileSync(path.join(ROOT, 'audit/fresh-checkout-simulation.json'), 'utf8'));
    cleanSimulationPass = (sim.status === 'CLEAN_CHECKOUT_SIMULATION_PASS');
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

  // 7. Generate audit/repository-manifest.json
  const manifest = {
    releaseVersion: '0.1.0-beta.1',
    coreBaseline: 'CORE_BASELINE_0.1.0-beta.1',
    filesToCommit,
    ignoredFiles,
    workflow: '.github/workflows/ci.yml',
    runtimeGateJob: 'phase2-container-runtime-gate',
    cleanCheckoutSimulation: cleanSimulationPass,
    secretScanPass,
    portablePathsPass,
    coreBaselinePass,
    git: {
      initialized: true,
      remoteUrl: REMOTE_URL,
      version: gitVer
    },
    generatedAt: new Date().toISOString()
  };

  const manifestPath = path.join(ROOT, 'audit/repository-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\nRepository manifest written to ${manifestPath}`);

  // 8. Write status short to audit/git-handoff-status.log
  const logContent = [
    `=== GIT HANDOFF STATUS LOG ===`,
    `Timestamp: ${new Date().toISOString()}`,
    `Remote: ${REMOTE_URL}`,
    `Files to commit: ${filesToCommit}`,
    `Ignored items: ${ignoredFiles}`,
    `\n--- GIT STATUS --SHORT ---`,
    statusShort,
    `\n--- GIT IGNORED (SAMPLE) ---`,
    ignoredLines.slice(0, 50).join('\n')
  ].join('\n');

  fs.writeFileSync(path.join(ROOT, 'audit/git-handoff-status.log'), logContent, 'utf8');
  console.log('Saved audit/git-handoff-status.log');

  return manifest;
}

if (require.main === module) {
  prepareGitAndManifest();
}

module.exports = { prepareGitAndManifest };
