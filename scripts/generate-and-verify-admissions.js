const fs = require('fs');
const path = require('path');
const { recover } = require('../packages/core/src');

async function obfuscateScript(script, retries = 5) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch('https://wearedevs.net/api/obfuscate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ script })
      });
      if (res.status === 429) {
        const delay = 3000 * (attempt + 1);
        console.log(`Rate limited (429), waiting ${delay}ms before retry ${attempt + 1}/${retries}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success || !data.obfuscated) throw new Error(`API failed: ${JSON.stringify(data)}`);
      await new Promise(resolve => setTimeout(resolve, 1500));
      return data.obfuscated;
    } catch (err) {
      if (attempt === retries - 1) throw err;
      const delay = 2000 * (attempt + 1);
      console.log(`Request error (${err.message}), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

const NEGATIVE_CASES = [
  { id: 'neg_01_free_foo', script: 'print(foo)' },
  { id: 'neg_02_free_a', script: 'print(a)' },
  { id: 'neg_03_free_x9AbC', script: 'print(x9AbC)' },
  { id: 'neg_04_external_fn_q', script: 'local z = q()\nprint(z)' },
  { id: 'neg_05_external_consumer_k', script: 'local t = {x = 1}\nk(t)\nprint(t.x)' },
  { id: 'neg_06_dynamic_G_key', script: 'local name = "f" .. tostring(os.time())\nlocal fn = _G[name]\nif fn then fn() end' },
  { id: 'neg_07_env_shadow_builtin', script: '_ENV.print = externalFunction\nprint("hi")' },
  { id: 'neg_08_global_shadow_builtin', script: 'print = externalFunction\nprint("hi")' },
  { id: 'neg_09_getfenv_dynamic', script: 'local env = getfenv()\nprint(env.foo)' },
  { id: 'neg_10_setfenv_replace', script: 'setfenv(1, {})\nprint("hi")' },
  { id: 'neg_11_unknown_callback_hook', script: 'local h = hook\nif h then h(function() print(1) end) end' },
  { id: 'neg_12_env_alias_lookup', script: 'local e = _ENV\nlocal g = e.x9AbC\nprint(g)' }
];

const POSITIVE_CASES = [
  { id: 'pos_01_local_externalValue', script: 'local externalValue = 5\nprint(externalValue)' },
  { id: 'pos_02_local_externalFunction', script: 'local function externalFunction()\n    return 42\nend\nprint(externalFunction())' },
  { id: 'pos_03_local_externalInput', script: 'local externalInput = {1, 2, 3}\nprint(#externalInput)' },
  { id: 'pos_04_local_playerData', script: 'local playerData = {score = 100, name = "Hero"}\nprint(playerData.score)' },
  { id: 'pos_05_local_foo', script: 'local foo = 10\nprint(foo)' },
  { id: 'pos_06_local_x9AbC', script: 'local x9AbC = "secret"\nprint(x9AbC)' },
  { id: 'pos_07_local_q_fn', script: 'local function q()\n    return 5\nend\nprint(q())' },
  { id: 'pos_08_local_nested_external', script: 'local function wrap()\n    local externalData = 99\n    return externalData + 1\nend\nprint(wrap())' },
  { id: 'pos_09_local_multi_external', script: 'local externalA, externalB = 10, 20\nprint(externalA + externalB)' },
  { id: 'pos_10_local_metatable_external', script: 'local externalMeta = {__tostring = function() return "OK" end}\nlocal t = setmetatable({}, externalMeta)\nprint(tostring(t))' }
];

async function main() {
  const baseDir = path.join(__dirname, '..', 'tests', 'temp', 'adversarial-admissions');
  fs.mkdirSync(baseDir, { recursive: true });

  console.log('=== Step 1: Processing 12 Adversarial Negative Cases ===');
  let negPassed = 0;
  const negResults = [];

  for (const c of NEGATIVE_CASES) {
    const caseDir = path.join(baseDir, c.id);
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(path.join(caseDir, 'original.lua'), c.script, 'utf8');

    let protectedCode;
    const protPath = path.join(caseDir, 'protected.lua');
    if (fs.existsSync(protPath)) {
      protectedCode = fs.readFileSync(protPath, 'utf8');
    } else {
      console.log(`Protecting ${c.id}...`);
      protectedCode = await obfuscateScript(c.script);
      fs.writeFileSync(protPath, protectedCode, 'utf8');
    }

    // Recover received protected.lua ONLY
    const res = recover(protectedCode, { stage: 'L5', filename: `${c.id}.lua` });
    const isL5W = res.report?.completeness?.isL5WEligible || res.report?.recoveryLevel === 'L5-W';
    const finalLevel = res.report?.recoveryLevel || res.stage;
    const denied = !isL5W && (finalLevel === 'L4' || finalLevel === 'L4.5' || finalLevel === 'L3.5');

    if (denied) {
      negPassed++;
      console.log(`  [PASS] ${c.id} -> L5-W DENIED (${finalLevel})`);
    } else {
      console.log(`  [FAIL] ${c.id} -> Falsely admitted L5-W! Level: ${finalLevel}`);
    }

    negResults.push({
      id: c.id,
      denied,
      finalLevel,
      externalInputs: res.report?.completeness?.audit?.externalInputs || []
    });
  }

  console.log(`\nAdversarial Negatives: ${negPassed}/${NEGATIVE_CASES.length} denied L5-W\n`);

  console.log('=== Step 2: Processing 10 Positive Closed Cases ===');
  let posPassed = 0;
  const posResults = [];

  for (const c of POSITIVE_CASES) {
    const caseDir = path.join(baseDir, c.id);
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(path.join(caseDir, 'original.lua'), c.script, 'utf8');

    let protectedCode;
    const protPath = path.join(caseDir, 'protected.lua');
    if (fs.existsSync(protPath)) {
      protectedCode = fs.readFileSync(protPath, 'utf8');
    } else {
      console.log(`Protecting ${c.id}...`);
      protectedCode = await obfuscateScript(c.script);
      fs.writeFileSync(protPath, protectedCode, 'utf8');
    }

    const res = recover(protectedCode, { stage: 'L5', filename: `${c.id}.lua` });
    const isL5W = res.report?.completeness?.isL5WEligible || res.report?.recoveryLevel === 'L5-W';
    const finalLevel = res.report?.recoveryLevel || res.stage;

    if (isL5W) {
      posPassed++;
      console.log(`  [PASS] ${c.id} -> L5-W ADMITTED (${finalLevel})`);
    } else {
      console.log(`  [FAIL] ${c.id} -> False negative! Denied L5-W. Level: ${finalLevel}`);
      console.log('    External inputs:', res.report?.completeness?.audit?.externalInputs);
    }

    posResults.push({
      id: c.id,
      admitted: isL5W,
      finalLevel
    });
  }

  console.log(`\nPositive Closed: ${posPassed}/${POSITIVE_CASES.length} admitted L5-W\n`);

  console.log('=== Step 3: Metamorphic Identifier Invariance Verification ===');
  // Rename test on negative case neg_01: foo -> externalValue -> A9zQ -> print_var
  const metamorphicNegatives = [
    'print(foo)',
    'print(externalValue)',
    'print(A9zQ)',
    'print(customGlobalVariable)'
  ];
  let metamorphicPass = true;
  for (let mi = 0; mi < metamorphicNegatives.length; mi++) {
    const script = metamorphicNegatives[mi];
    const protPath = path.join(baseDir, `metamorphic_neg_${mi}.lua`);
    let prot;
    if (fs.existsSync(protPath)) {
      prot = fs.readFileSync(protPath, 'utf8');
    } else {
      prot = await obfuscateScript(script);
      fs.writeFileSync(protPath, prot, 'utf8');
    }
    const r = recover(prot, { stage: 'L5', filename: `metamorphic_neg_${mi}.lua` });
    const isL5W = r.report?.completeness?.isL5WEligible || r.report?.recoveryLevel === 'L5-W';
    if (isL5W) {
      metamorphicPass = false;
      console.log(`  [FAIL] Metamorphic script "${script}" was falsely admitted L5-W!`);
    } else {
      console.log(`  [PASS] Metamorphic negative "${script}" -> L5-W DENIED`);
    }
  }

  // Rename test on positive case pos_01: local externalValue = 5 -> local foo = 5 -> local a = 5 -> local x9AbC = 5
  const metamorphicPositives = [
    'local externalValue = 5\nprint(externalValue)',
    'local foo = 5\nprint(foo)',
    'local a = 5\nprint(a)',
    'local x9AbC = 5\nprint(x9AbC)'
  ];
  for (let mi = 0; mi < metamorphicPositives.length; mi++) {
    const script = metamorphicPositives[mi];
    const protPath = path.join(baseDir, `metamorphic_pos_${mi}.lua`);
    let prot;
    if (fs.existsSync(protPath)) {
      prot = fs.readFileSync(protPath, 'utf8');
    } else {
      prot = await obfuscateScript(script);
      fs.writeFileSync(protPath, prot, 'utf8');
    }
    const r = recover(prot, { stage: 'L5', filename: `metamorphic_pos_${mi}.lua` });
    const isL5W = r.report?.completeness?.isL5WEligible || r.report?.recoveryLevel === 'L5-W';
    if (!isL5W) {
      metamorphicPass = false;
      console.log(`  [FAIL] Metamorphic positive "${script.replace('\n', '; ')}" was falsely denied L5-W!`);
    } else {
      console.log(`  [PASS] Metamorphic positive "${script.replace('\n', '; ')}" -> L5-W ADMITTED`);
    }
  }

  const invarianceStatus = metamorphicPass ? 'PASS' : 'FAIL';
  console.log(`IDENTIFIER_INVARIANCE: ${invarianceStatus}`);

  // Write audit results
  const auditDir = path.join(__dirname, '..', 'audit');
  fs.mkdirSync(auditDir, { recursive: true });

  fs.writeFileSync(path.join(auditDir, 'adversarial-admissions-report.json'), JSON.stringify({
    timestamp: new Date().toISOString(),
    adversarialNegatives: {
      total: NEGATIVE_CASES.length,
      denied: negPassed,
      results: negResults
    },
    positiveClosed: {
      total: POSITIVE_CASES.length,
      admitted: posPassed,
      results: posResults
    },
    identifierInvariance: invarianceStatus
  }, null, 2), 'utf8');

  console.log('\nWrote audit/adversarial-admissions-report.json');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
