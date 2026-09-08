const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = 'c:/Users/ksjz1/Downloads/deobfuscator';

function runGit(args) {
  const res = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', PAGER: 'cat' }
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

console.log('=== FETCHING ORIGIN AND ANALYZING COMMIT HISTORY ===');
const fetchRes = runGit(['fetch', 'origin']);
const logRes = runGit(['log', '--oneline', '--graph', '--decorate', '--all', '-20']);
const originHeadRes = runGit(['log', '-n', '5', 'origin/main']);
const branchRes = runGit(['branch', '-a']);

const analysis = {
  fetch: fetchRes,
  logGraph: logRes.stdout,
  originMainRecent: originHeadRes.stdout,
  branches: branchRes.stdout
};

fs.writeFileSync(path.join(ROOT, 'audit/remote-history-analysis.json'), JSON.stringify(analysis, null, 2), 'utf8');
console.log('Saved audit/remote-history-analysis.json');
