const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const dataDirectory = path.join(root, 'apps', 'discord-bot', 'data');
const pidPath = path.join(dataDirectory, 'supervisor.pid');
const logPath = path.join(dataDirectory, 'supervisor.log');
const botEntry = path.join(root, 'apps', 'discord-bot', 'src', 'index.js');

fs.mkdirSync(dataDirectory, { recursive: true });

function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

if (fs.existsSync(pidPath)) {
  const existingPid = Number.parseInt(fs.readFileSync(pidPath, 'utf8'), 10);
  if (processExists(existingPid)) {
    console.log(`Valax Discord supervisor is already running as PID ${existingPid}.`);
    process.exit(0);
  }
  fs.rmSync(pidPath, { force: true });
}

fs.writeFileSync(pidPath, String(process.pid), { encoding: 'utf8', mode: 0o600 });
const log = fs.openSync(logPath, 'a');
let child = null;
let restartTimer = null;
let stopping = false;
let restartDelayMs = 3_000;

function writeLog(message) {
  fs.writeSync(log, `[${new Date().toISOString()}] ${message}\n`);
}

function startBot() {
  if (stopping) return;
  const startedAt = Date.now();
  child = spawn(process.execPath, [botEntry], {
    cwd: root,
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', log, log]
  });
  writeLog(`Started Discord bot as PID ${child.pid}.`);

  child.once('exit', (code, signal) => {
    const lifetimeMs = Date.now() - startedAt;
    writeLog(`Discord bot exited (code=${code}, signal=${signal}, lifetimeMs=${lifetimeMs}).`);
    child = null;
    if (stopping) return;
    restartDelayMs = lifetimeMs >= 300_000 ? 3_000 : Math.min(60_000, restartDelayMs * 2);
    writeLog(`Restart scheduled in ${restartDelayMs}ms.`);
    restartTimer = setTimeout(startBot, restartDelayMs);
  });
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  writeLog(`Supervisor stopping after ${signal}.`);
  if (child && !child.killed) child.kill('SIGTERM');
  try {
    if (Number.parseInt(fs.readFileSync(pidPath, 'utf8'), 10) === process.pid) fs.rmSync(pidPath, { force: true });
  } catch {}
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', error => {
  writeLog(`Supervisor error: ${error.stack || error.message}`);
});
process.on('exit', () => {
  try {
    if (Number.parseInt(fs.readFileSync(pidPath, 'utf8'), 10) === process.pid) fs.rmSync(pidPath, { force: true });
  } catch {}
});

writeLog(`Supervisor online as PID ${process.pid}.`);
startBot();

module.exports = { processExists };
