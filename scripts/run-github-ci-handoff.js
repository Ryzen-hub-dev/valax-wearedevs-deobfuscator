/**
 * GitHub CI Handoff Runner
 * Executes steps 1 through 7 of the real GitHub CI handoff:
 * Git capability verification, remote configuration, pre-commit security gates,
 * staging, committing, branching to main, pushing to origin, and remote SHA verification.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { CoreBaselineGuard } = require('../packages/worker/src');

const ROOT = path.resolve(__dirname, '..');
const REMOTE_URL = 'https://github.com/Ryzen-hub-dev/valax-wearedevs-deobfuscator';
const LOG_FILE = path.join(ROOT, 'audit/github-handoff-execution.log');

function log(msg) {
  console.log(msg);
  fs.appendFileSync(LOG_FILE, msg + '\n', 'utf8');
}

function runGit(args, opts = {}) {
  const res = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', PAGER: 'cat' },
    ...opts
  });
  const record = {
    cmd: `git ${args.join(' ')}`,
    status: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim()
  };
  log(`> ${record.cmd} (exit: ${record.status})`);
  if (record.stdout) log(record.stdout);
  if (record.stderr) log(`[stderr] ${record.stderr}`);
  return record;
}

async function main() {
  fs.writeFileSync(LOG_FILE, `=== GITHUB CI HANDOFF EXECUTION LOG ===\nStarted: ${new Date().toISOString()}\n\n`, 'utf8');

  log('=== STEP 1: Verify actual Git capability ===');
  const ver = runGit(['--version']);
  const status = runGit(['status']);
  const toplevel = runGit(['rev-parse', '--show-toplevel']);
  const remoteBefore = runGit(['remote', '-v']);
  const userName = runGit(['config', '--get', 'user.name']);
  const userEmail = runGit(['config', '--get', 'user.email']);

  log('\n=== STEP 2: Configure the known remote ===');
  let currentOrigin = '';
  if (remoteBefore.stdout) {
    const lines = remoteBefore.stdout.split('\n');
    for (const l of lines) {
      if (l.startsWith('origin')) {
        const parts = l.split(/\s+/);
        if (parts[1]) currentOrigin = parts[1];
        break;
      }
    }
  }

  if (!currentOrigin) {
    log(`Adding remote origin: ${REMOTE_URL}`);
    runGit(['remote', 'add', 'origin', REMOTE_URL]);
  } else if (currentOrigin === REMOTE_URL) {
    log(`Remote origin already set correctly to: ${REMOTE_URL}`);
  } else {
    log(`Origin was set to ${currentOrigin}, updating to: ${REMOTE_URL}`);
    runGit(['remote', 'set-url', 'origin', REMOTE_URL]);
  }

  const remoteAfter = runGit(['remote', '-v']);

  log('\n=== STEP 3: Pre-commit security gate ===');
  // 3a. Core baseline guard
  const guard = new CoreBaselineGuard();
  const coreVer = guard.verify(ROOT);
  log(`CoreBaselineGuard: verified=${coreVer.verified}, checked=${coreVer.totalChecked}, mismatches=${coreVer.mismatches.length}`);
  if (!coreVer.verified || coreVer.totalChecked !== 51) {
    throw new Error(`CORE_BASELINE_CHECK_FAILED: Expected 51/51 verified, got ${coreVer.totalChecked}, mismatches: ${JSON.stringify(coreVer.mismatches)}`);
  }

  // 3b. Secret scan verification
  const hygienePath = path.join(ROOT, 'audit/repository-hygiene.json');
  if (!fs.existsSync(hygienePath)) {
    throw new Error('repository-hygiene.json not found! Run audit first.');
  }
  const hygiene = JSON.parse(fs.readFileSync(hygienePath, 'utf8'));
  log(`Secret scan pass: ${hygiene.secretScan.pass}, findings: ${hygiene.secretScan.findings.length}`);
  if (!hygiene.secretScan.pass || hygiene.secretScan.findings.length > 0) {
    throw new Error('SECRET_SCAN_FAILED: Sensitive credentials found in repository!');
  }

  // 3c. Pre-add status check
  const preStatus = runGit(['status', '--short']);

  log('\n=== STEP 4: Staging (git add .) ===');
  runGit(['add', '.']);
  const postAddStatus = runGit(['status', '--short']);
  const stagedLines = postAddStatus.stdout.split('\n').filter(l => l.trim().startsWith('A') || l.trim().startsWith('M'));
  const stagedFileCount = stagedLines.length;
  log(`Staged file count: ${stagedFileCount}`);

  // Ensure forbidden files are not staged
  const forbidden = [/\.env/, /credentials/, /node_modules/, /scratch/, /transcript/];
  for (const line of stagedLines) {
    for (const pat of forbidden) {
      if (pat.test(line)) {
        throw new Error(`SECURITY_GATE_VIOLATION: Forbidden file staged: ${line}`);
      }
    }
  }
  log('✔ Zero forbidden files staged.');

  log('\n=== STEP 5: Commit ===');
  const commitRes = runGit(['commit', '-m', 'feat(phase2): hosted isolation and Linux runtime release gate']);
  log(`Commit exit code: ${commitRes.status}`);

  log('\n=== STEP 6: Branch & Head SHA ===');
  runGit(['branch', '-M', 'main']);
  const headShaRes = runGit(['rev-parse', 'HEAD']);
  const localCommitSha = headShaRes.stdout;
  log(`Local HEAD Commit SHA: ${localCommitSha}`);

  log('\n=== STEP 7: Push to remote (origin main) ===');
  const pushRes = runGit(['push', '-u', 'origin', 'main']);
  log(`Push exit code: ${pushRes.status}`);

  if (pushRes.status !== 0 && pushRes.stderr.includes('non-fast-forward')) {
    log('Remote has existing history. Fetching origin...');
    runGit(['fetch', 'origin']);
    runGit(['log', '--oneline', '--graph', '--decorate', '--all', '-20']);
  }

  log('\n=== STEP 8: Verify Remote Commit ===');
  const lsRemote = runGit(['ls-remote', 'origin', 'refs/heads/main']);
  log(`ls-remote output: ${lsRemote.stdout}`);

  const matchRemoteSha = lsRemote.stdout.split(/\s+/)[0];
  log(`Remote SHA: ${matchRemoteSha}`);
  log(`Local SHA:  ${localCommitSha}`);

  const verified = (matchRemoteSha === localCommitSha);
  log(`Remote commit verified: ${verified}`);

  const finalSummary = {
    gitVersion: ver.stdout,
    userName: userName.stdout,
    userEmail: userEmail.stdout,
    remoteUrl: REMOTE_URL,
    stagedFileCount,
    commitSha: localCommitSha,
    pushStatus: pushRes.status,
    pushOutput: pushRes.stdout || pushRes.stderr,
    remoteSha: matchRemoteSha,
    remoteCommitVerified: verified
  };

  fs.writeFileSync(path.join(ROOT, 'audit/github-handoff-result.json'), JSON.stringify(finalSummary, null, 2), 'utf8');
  log('\n=== SUMMARY ===\n' + JSON.stringify(finalSummary, null, 2));

  return finalSummary;
}

main().catch(err => {
  log(`\nFATAL ERROR: ${err.message}\n${err.stack}`);
  process.exit(1);
});
