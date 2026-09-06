const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { SemanticOracle, SemanticTrace } = require('../packages/core/src/oracle/semantic-oracle');

const CORPUS_DIR = path.resolve(__dirname, '../tests/blind-protected-corpus');
const oracle = new SemanticOracle();

// Standalone Worker Script Content
const workerScriptContent = `
const fs = require('fs');
const path = require('path');
const { RecoveryService } = require('${path.resolve(__dirname, '../packages/core/src').replace(/\\/g, '/')}');

const args = process.argv.slice(2);
const protectedPath = args[0];
const outCodePath = args[1];
const outReportPath = args[2];

const res = RecoveryService.recover({
  filePath: protectedPath,
  requestedStage: 'auto',
  semanticValidation: false
});

fs.writeFileSync(outCodePath, res.code || '', 'utf8');
fs.writeFileSync(outReportPath, JSON.stringify(res.report || {}, null, 2), 'utf8');
process.exit(res.exitCode);
`;

function runWorkerOnSample(sampleDir, sampleId) {
  const protFile = path.join(sampleDir, 'protected.lua');
  if (!fs.existsSync(protFile)) {
    throw new Error(`protected.lua not found in ${sampleDir}`);
  }

  // 1. Create unique, randomized temporary isolation directory
  const randomId = crypto.randomBytes(8).toString('hex');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `valax-worker-${randomId}-`));
  const randomProtFile = path.join(tempDir, `${randomId}.lua`);
  const workerScriptFile = path.join(tempDir, 'worker.js');
  const outCodeFile = path.join(tempDir, 'recovered.lua');
  const outReportFile = path.join(tempDir, 'report.json');

  // Copy ONLY the protected script to randomized name. Absolutely NO original.lua or metadata
  fs.copyFileSync(protFile, randomProtFile);
  fs.writeFileSync(workerScriptFile, workerScriptContent, 'utf8');

  // Ensure original.lua and expected.lua are strictly absent in worker dir
  const dirContents = fs.readdirSync(tempDir);
  if (dirContents.includes('original.lua') || dirContents.includes('expected.lua') || dirContents.includes('metadata.json')) {
    throw new Error('CORPUS LEAKAGE: Prohibited files present in worker sandbox directory');
  }

  // 2. Launch separate isolated Node process
  const child = spawnSync(process.execPath, [workerScriptFile, randomProtFile, outCodeFile, outReportFile], {
    cwd: tempDir,
    timeout: 10000,
    encoding: 'utf8'
  });

  if (child.status !== 0) {
    console.error(`Worker error for ${sampleId}:`, child.stderr);
  }

  let recCode = '';
  let recReport = {};
  if (fs.existsSync(outCodeFile)) recCode = fs.readFileSync(outCodeFile, 'utf8');
  if (fs.existsSync(outReportFile)) recReport = JSON.parse(fs.readFileSync(outReportFile, 'utf8'));

  // Cleanup temp dir
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {}

  return {
    exitCode: child.status,
    recCode,
    recReport,
    randomId
  };
}

async function runRandomizedPathAudit() {
  console.log('====================================================');
  console.log('   BLIND CORPUS RANDOMIZED-PATH INDEPENDENCE AUDIT  ');
  console.log('====================================================\n');

  const sampleDirs = fs.readdirSync(CORPUS_DIR)
    .filter(f => fs.statSync(path.join(CORPUS_DIR, f)).isDirectory());

  console.log(`Auditing ${sampleDirs.length} blind samples with randomized filenames in isolated subprocesses...\n`);

  const results = [];
  let matchingLevelsCount = 0;
  let filenameDependencyDetected = false;
  let silentCorruptionCount = 0;

  for (let i = 0; i < sampleDirs.length; i++) {
    const sampleId = sampleDirs[i];
    const samplePath = path.join(CORPUS_DIR, sampleId);

    // Read baseline report from previous run
    const prevRepPath = path.join(samplePath, 'report.json');
    const prevReport = fs.existsSync(prevRepPath) ? JSON.parse(fs.readFileSync(prevRepPath, 'utf8')) : null;
    const prevLevel = prevReport?.recovery?.actualLevel || 'UNKNOWN';

    // Execute isolated worker with randomized name
    const workerRes = runWorkerOnSample(samplePath, sampleId);
    const newLevel = workerRes.recReport.recovery?.actualLevel || 'NONE';

    const levelMatches = prevLevel === newLevel;
    if (levelMatches) matchingLevelsCount++;
    else {
      filenameDependencyDetected = true;
      console.warn(`[MISMATCH] ${sampleId}: Previous=${prevLevel}, Randomized=${newLevel}`);
    }

    // Independent BlindValidator: reads original.lua in parent process
    const origPath = path.join(samplePath, 'original.lua');
    let silentCorruption = false;
    if (fs.existsSync(origPath) && workerRes.recCode && oracle.luaBinary) {
      const origSource = fs.readFileSync(origPath, 'utf8');
      const origTrace = oracle.trace(origSource);
      const recTrace = oracle.trace(workerRes.recCode);

      if (origTrace.success && recTrace.success) {
        const cmp = SemanticTrace.compare(origTrace.events, recTrace.events);
        if (!cmp.match && newLevel === 'L5-W') {
          silentCorruption = true;
          silentCorruptionCount++;
          console.error(`[CORRUPTION] Semantic mismatch for ${sampleId} at L5-W!`);
        }
      }
    }

    results.push({
      sampleId,
      randomWorkerId: workerRes.randomId,
      previousLevel: prevLevel,
      randomizedLevel: newLevel,
      levelMatches,
      silentCorruption,
      residualDispatcherStates: workerRes.recReport.recovery?.dispatcherStatesAfter || 0,
      exitCode: workerRes.exitCode
    });

    console.log(`[${i + 1}/${sampleDirs.length}] ${sampleId}: Level=${newLevel} (Matches baseline: ${levelMatches}) [Worker ID: ${workerRes.randomId}]`);
  }

  console.log('\n====================================================');
  console.log('                AUDIT VERDICT SUMMARY               ');
  console.log('====================================================');
  console.log(`Total Samples Audited:          ${sampleDirs.length}`);
  console.log(`Consistent Level Matches:       ${matchingLevelsCount} / ${sampleDirs.length}`);
  console.log(`Filename Dependency Detected:   ${filenameDependencyDetected}`);
  console.log(`Silent Semantic Corruption:     ${silentCorruptionCount}`);

  const auditReport = {
    timestamp: new Date().toISOString(),
    totalSamples: sampleDirs.length,
    matchingLevelsCount,
    filenameDependencyDetected,
    silentCorruptionCount,
    samples: results
  };

  const outAuditPath = path.resolve(__dirname, '../audit/blind-corpus-randomized-audit.json');
  fs.writeFileSync(outAuditPath, JSON.stringify(auditReport, null, 2), 'utf8');
  console.log(`Audit report saved to: ${outAuditPath}\n`);

  if (filenameDependencyDetected || silentCorruptionCount > 0) {
    throw new Error('RANDOMIZED PATH AUDIT FAILED');
  }

  return auditReport;
}

if (require.main === module) {
  runRandomizedPathAudit().catch(err => {
    console.error('Fatal error during randomized path audit:', err);
    process.exit(1);
  });
}

module.exports = { runRandomizedPathAudit };
