const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'c:/Users/ksjz1/Downloads/deobfuscator';

function runGit(args, env = {}) {
  const res = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', PAGER: 'cat', ...env }
  });
  const output = {
    cmd: `git ${args.join(' ')}`,
    status: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim()
  };
  console.log(`> ${output.cmd} (exit: ${output.status})`);
  if (output.stdout) console.log(output.stdout);
  if (output.stderr) console.log(`[stderr] ${output.stderr}`);
  return output;
}

// 1. Verify Core Baseline Guard
const { CoreBaselineGuard } = require(path.join(ROOT, 'packages/worker/src'));
const guard = new CoreBaselineGuard(path.join(ROOT, 'audit/core-baseline-hashes.json'));
const check = guard.verify(ROOT);
console.log(`CoreBaselineGuard: totalChecked=${check.totalChecked}, verified=${check.verified}, mismatches=${check.mismatches.length}`);
if (!check.verified || check.mismatches.length > 0) {
  console.error('FATAL: CoreBaselineGuard failed!', check.mismatches);
  process.exit(1);
}

// 2. Stage fixes
console.log('\n=== STAGING FIXES ===');
runGit(['add',
  '.github/workflows/ci.yml',
  'scripts/verify-phase2-container-runtime.js',
  'tests/integration/redis-multi-process-queue.test.js',
  'tests/fixtures/adversarial/external_global_negative.lua',
  'tests/integration/helpers/redis-producer-process.js',
  'tests/integration/helpers/redis-consumer-process.js'
]);
runGit(['status', '--short']);

// 3. Commit
console.log('\n=== COMMITTING FIXES ===');
const commitRes = runGit(['commit', '-m', 'test(phase2): complete real container e2e, timeout, cancel, cleanup, and redis multi-process evidence']);
console.log('Commit exit:', commitRes.status);

// 4. Verify local HEAD
const headRes = runGit(['rev-parse', 'HEAD']);
const newHeadSha = headRes.stdout;
console.log('New Local HEAD SHA:', newHeadSha);

// 5. Push to origin main
console.log('\n=== PUSHING TO ORIGIN MAIN ===');
const pushRes = runGit(['push', 'origin', 'main']);

// 6. Verify remote commit
console.log('\n=== VERIFYING REMOTE COMMIT ===');
const lsRemoteRes = runGit(['ls-remote', 'origin', 'refs/heads/main']);
const remoteSha = lsRemoteRes.stdout.split(/\s+/)[0];

const verified = (remoteSha === newHeadSha);
console.log(`Remote SHA: ${remoteSha}`);
console.log(`Local SHA:  ${newHeadSha}`);
console.log(`REMOTE_COMMIT_VERIFIED: ${verified}`);

const result = {
  localHeadSha: newHeadSha,
  remoteSha,
  verified,
  pushStatus: pushRes.status,
  pushOutput: pushRes.stdout || pushRes.stderr
};

fs.writeFileSync(path.join(ROOT, 'audit/latest-push.json'), JSON.stringify(result, null, 2), 'utf8');
