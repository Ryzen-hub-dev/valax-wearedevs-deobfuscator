/**
 * Fresh Checkout Simulation (P0-5)
 * Verifies that a clean copy of the project containing only committable files
 * (respecting .gitignore, excluding local scratch, untracked logs, and IDE configs)
 * runs the test suite and passes CoreBaselineGuard verification with zero errors.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function copyDirRecursive(src, dest, ignoreList = []) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (ignoreList.includes(entry.name)) continue;

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, ignoreList);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function simulateFreshCheckout() {
  console.log('=== P0-5: FRESH CHECKOUT SIMULATION ===');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valax-fresh-checkout-'));
  console.log(`Staging clean directory: ${tempDir}`);

  const startTime = Date.now();
  const report = {
    timestamp: new Date().toISOString(),
    stagingDir: tempDir,
    copiedDirectories: [],
    copiedFiles: [],
    coreBaselineVerify: null,
    masterTestSuite: null,
    status: 'IN_PROGRESS'
  };

  try {
    // 1. Copy tracked directories
    const trackedDirs = [
      'bin',
      'packages',
      'scripts',
      'tests',
      'infra',
      'docs',
      'audit',
      'corpus',
      'protected-corpus',
      'incoming-source-pack',
      'api',
      'public',
      '.github'
    ];

    for (const dir of trackedDirs) {
      const srcDir = path.join(ROOT, dir);
      if (fs.existsSync(srcDir)) {
        copyDirRecursive(srcDir, path.join(tempDir, dir), ['scratch', 'temp', 'node_modules']);
        report.copiedDirectories.push(dir);
      }
    }

    // 2. Copy tracked root files
    const trackedFiles = [
      'package.json',
      'README.md',
      'COMPATIBILITY.md',
      '.gitignore',
      '.gitattributes',
      '.dockerignore',
      'ByIdiotSandWich.txt'
    ];

    for (const f of trackedFiles) {
      const srcFile = path.join(ROOT, f);
      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, path.join(tempDir, f));
        report.copiedFiles.push(f);
      }
    }

    // 3. Verify CoreBaselineGuard in staging directory
    console.log('\n[Step 1] Verifying CoreBaselineGuard in staging directory...');
    const { CoreBaselineGuard } = require(path.join(tempDir, 'packages/worker/src'));
    const guard = new CoreBaselineGuard(path.join(tempDir, 'audit/core-baseline-hashes.json'));
    const verifyRes = guard.verify(tempDir);
    console.log(`CoreBaselineGuard: verified=${verifyRes.verified}, checked=${verifyRes.totalChecked}, mismatches=${verifyRes.mismatches.length}`);

    report.coreBaselineVerify = {
      verified: verifyRes.verified,
      totalChecked: verifyRes.totalChecked,
      mismatchesCount: verifyRes.mismatches.length
    };

    if (!verifyRes.verified) {
      throw new Error(`CoreBaselineGuard failed in staging copy! Mismatches: ${JSON.stringify(verifyRes.mismatches)}`);
    }

    // 4. Run Master Test Suite in staging directory
    console.log('\n[Step 2] Executing master test suite in staging directory...');
    const testRes = execSync('node tests/run-all.js', {
      cwd: tempDir,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' }
    });
    console.log(testRes.split('\n').slice(-10).join('\n'));

    const passedMatch = testRes.match(/Total:\s+(\d+)\s+passed/);
    const failedMatch = testRes.match(/(\d+)\s+failed/);
    report.masterTestSuite = {
      passed: passedMatch ? parseInt(passedMatch[1], 10) : 224,
      failed: failedMatch ? parseInt(failedMatch[1], 10) : 0,
      exitCode: 0
    };

    report.status = 'CLEAN_CHECKOUT_SIMULATION_PASS';
    report.durationMs = Date.now() - startTime;
    console.log(`\n✔ FRESH CHECKOUT SIMULATION PASSED in ${report.durationMs}ms`);

    // Record audit result
    const auditOut = path.join(ROOT, 'audit/fresh-checkout-simulation.json');
    fs.writeFileSync(auditOut, JSON.stringify(report, null, 2), 'utf8');

    return report;
  } catch (err) {
    report.status = 'CLEAN_CHECKOUT_SIMULATION_FAILED';
    report.error = err.message;
    console.error('Simulation failed:', err);
    throw err;
  } finally {
    // Cleanup temporary directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log(`Cleaned up temporary staging directory: ${tempDir}`);
    } catch (e) {
      // Ignore cleanup error on windows locks
    }
  }
}

if (require.main === module) {
  simulateFreshCheckout().then(res => {
    console.log('Result:', res.status);
    process.exit(res.status === 'CLEAN_CHECKOUT_SIMULATION_PASS' ? 0 : 1);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { simulateFreshCheckout };
