const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TARGET_DIR = path.resolve(__dirname, '../tests/temp/negative-blind');
const AUDIT_DIR = path.resolve(__dirname, '../audit');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function obfuscateWithWeAreDevs(sourceCode, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch('https://wearedevs.net/api/obfuscate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ValaxTest/1.0'
        },
        body: JSON.stringify({ script: sourceCode })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success || !data.obfuscated) throw new Error(`Failed: ${JSON.stringify(data)}`);
      return data.obfuscated;
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(1000 * attempt);
    }
  }
}

const negativePrograms = [
  {
    id: 'negative_01_external_global',
    name: 'External Global Variable',
    source: `print(externalGlobalValue)`
  },
  {
    id: 'negative_02_external_function_call',
    name: 'External Function Invocation',
    source: `local x = externalFunction("query")
print(x)`
  },
  {
    id: 'negative_03_escaping_table_mutation',
    name: 'Escaping Table Consumer Mutation',
    source: `local t = { x = 10 }
externalConsumer(t)
print(t.x)`
  },
  {
    id: 'negative_04_dynamic_call_target',
    name: 'Dynamic Computed Call Target',
    source: `local fn = _G["dynamic_action_" .. tostring(os.time())]
if fn then
    fn()
end`
  },
  {
    id: 'negative_05_dynamic_vararg_call',
    name: 'Dynamic External Vararg Pass',
    source: `local function pass(...)
    return ...
end
print(pass(externalInput1, externalInput2))`
  }
];

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

async function runNegativeBlindTests() {
  console.log('====================================================');
  console.log('    NEGATIVE BLIND GENUINE-PROTECTED ADMISSION GATE ');
  console.log('====================================================\n');

  if (!fs.existsSync(TARGET_DIR)) fs.mkdirSync(TARGET_DIR, { recursive: true });
  if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true });

  const results = [];
  let falseL5WCount = 0;

  for (let i = 0; i < negativePrograms.length; i++) {
    const prog = negativePrograms[i];
    console.log(`[${i + 1}/${negativePrograms.length}] Protecting ${prog.id} (${prog.name})...`);

    const progDir = path.join(TARGET_DIR, prog.id);
    if (!fs.existsSync(progDir)) fs.mkdirSync(progDir, { recursive: true });

    const origFile = path.join(progDir, 'original.lua');
    const protFile = path.join(progDir, 'protected.lua');
    fs.writeFileSync(origFile, prog.source, 'utf8');

    let protectedSource;
    if (fs.existsSync(protFile)) {
      protectedSource = fs.readFileSync(protFile, 'utf8');
      console.log(`    Cached protected source loaded (${protectedSource.length} bytes)`);
    } else {
      console.log(`    Requesting genuine WeAreDevs protection via API...`);
      protectedSource = await obfuscateWithWeAreDevs(prog.source);
      fs.writeFileSync(protFile, protectedSource, 'utf8');
      console.log(`    Protected source received (${protectedSource.length} bytes)`);
      await sleep(500);
    }

    // Run isolated worker with randomized name
    const randomId = crypto.randomBytes(8).toString('hex');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `valax-neg-worker-${randomId}-`));
    const randomProtFile = path.join(tempDir, `${randomId}.lua`);
    const workerScriptFile = path.join(tempDir, 'worker.js');
    const outCodeFile = path.join(tempDir, 'recovered.lua');
    const outReportFile = path.join(tempDir, 'report.json');

    fs.copyFileSync(protFile, randomProtFile);
    fs.writeFileSync(workerScriptFile, workerScriptContent, 'utf8');

    const child = spawnSync(process.execPath, [workerScriptFile, randomProtFile, outCodeFile, outReportFile], {
      cwd: tempDir,
      timeout: 10000,
      encoding: 'utf8'
    });

    let recReport = {};
    if (fs.existsSync(outReportFile)) {
      recReport = JSON.parse(fs.readFileSync(outReportFile, 'utf8'));
    }

    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}

    const actualLevel = recReport.recovery?.actualLevel || 'NONE';
    const isL5W = actualLevel === 'L5-W';

    if (isL5W) {
      falseL5WCount++;
      console.error(`    [FAIL] FALSE L5-W ADMISSION: ${prog.id} improperly promoted to L5-W!`);
    } else {
      console.log(`    [PASS] ${prog.id} correctly denied L5-W (Actual Level: ${actualLevel}, ExitCode: ${child.status})`);
    }

    results.push({
      id: prog.id,
      name: prog.name,
      sourceBytes: prog.source.length,
      protectedBytes: protectedSource.length,
      recoveryLevel: actualLevel,
      admittedToL5W: isL5W,
      isCorrectlyDenied: !isL5W,
      exitCode: child.status,
      residualDispatcherStates: recReport.recovery?.dispatcherStatesAfter || 0
    });
  }

  const summary = {
    timestamp: new Date().toISOString(),
    totalNegativeSamples: negativePrograms.length,
    falseL5WCount,
    deniedCount: negativePrograms.length - falseL5WCount,
    allDenied: falseL5WCount === 0,
    samples: results
  };

  const outReportPath = path.join(AUDIT_DIR, 'negative-blind-audit.json');
  fs.writeFileSync(outReportPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log('\n====================================================');
  console.log('             NEGATIVE BLIND AUDIT SUMMARY           ');
  console.log('====================================================');
  console.log(`Total Negative Samples:  ${negativePrograms.length}`);
  console.log(`Correctly Denied L5-W:   ${summary.deniedCount} / ${negativePrograms.length}`);
  console.log(`False L5-W Promotions:   ${falseL5WCount}`);
  console.log(`Audit Status:            ${summary.allDenied ? 'PASS' : 'FAIL'}\n`);

  if (!summary.allDenied) {
    throw new Error('NEGATIVE BLIND ADMISSION GATE FAILED: FALSE L5-W ADMISSION DETECTED');
  }

  return summary;
}

if (require.main === module) {
  runNegativeBlindTests().catch(err => {
    console.error('Fatal error during negative blind test:', err);
    process.exit(1);
  });
}

module.exports = { runNegativeBlindTests };
