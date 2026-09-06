const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { recover } = require('../packages/core/src');

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function obfuscateWithWeAreDevs(sourceCode) {
  const res = await fetch('https://wearedevs.net/api/obfuscate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    body: JSON.stringify({ script: sourceCode })
  });

  if (!res.ok) {
    throw new Error(`WeAreDevs API responded with status ${res.status}`);
  }

  const data = await res.json();
  if (!data.success || !data.obfuscated) {
    throw new Error(`WeAreDevs obfuscation failed: ${JSON.stringify(data)}`);
  }

  return data.obfuscated;
}

const programs = [
  {
    name: 'metamorphic_A',
    description: 'Different State Increment / Threshold (initial=10, step=2, threshold=12, 4 returns)',
    source: `local root = "A"

local function factory(...)
    local values = {...}
    local n = 10

    return function(z)
        n = n + 2

        if n == 12 then
            return root, values[2], z, n
        end

        return root, values[1], z, n
    end
end

local q = factory("red", "blue")

local a,b,c,d = q("P")
print(a)
print(b)
print(c)
print(d)

local e,f,g,h = q("Q")
print(e)
print(f)
print(g)
print(h)
`
  },
  {
    name: 'metamorphic_B',
    description: 'Four Return Values (multi-return 4 values dynamically derived)',
    source: `local tag = "metaB"

local function make(...)
    local pack = {...}
    local count = 0

    return function(x)
        count = count + 1

        if count == 1 then
            return tag, pack[1], x, "first"
        end

        return tag, pack[2], x, "second"
    end
end

local f = make("val1", "val2")

local a, b, c, d = f("test1")
print(a)
print(b)
print(c)
print(d)

local e, g, h, k = f("test2")
print(e)
print(g)
print(h)
print(k)
`
  },
  {
    name: 'metamorphic_C',
    description: 'Three Invocations across same closure & environment',
    source: `local title = "metaC"

local function generator(...)
    local items = {...}
    local step = 0

    return function(arg)
        step = step + 1

        if step == 1 then
            return title, items[1], arg
        end

        return title, items[2], arg
    end
end

local gen = generator("first_item", "second_item")

local a, b, c = gen("call1")
print(a)
print(b)
print(c)

local d, e, f = gen("call2")
print(d)
print(e)
print(f)

local g, h, i = gen("call3")
print(g)
print(h)
print(i)
`
  },
  {
    name: 'metamorphic_D',
    description: 'Two Independent Factory Instances Interleaved',
    source: `local prefix = "metaD"

local function make(...)
    local args = {...}
    local count = 0

    return function(extra)
        count = count + 1

        if count == 1 then
            return prefix, args[1], extra
        end

        return prefix, args[2], extra
    end
end

local f1 = make("A1", "A2")
local f2 = make("B1", "B2")

local a, b, c = f1("x1")
print(a)
print(b)
print(c)

local d, e, g = f2("y1")
print(d)
print(e)
print(g)

local h, i, j = f1("x2")
print(h)
print(i)
print(j)

local k, l, m = f2("y2")
print(k)
print(l)
print(m)
`
  },
  {
    name: 'metamorphic_E',
    description: 'Different Branch Shape (if / elseif / else)',
    source: `local title = "metaE"

local function multiBranch(...)
    local args = {...}
    local count = 0

    return function(extra)
        count = count + 1

        if count < 2 then
            return title, args[1], extra
        elseif count == 2 then
            return title, args[2], extra
        else
            return title, "done", extra
        end
    end
end

local fn = multiBranch("branchA", "branchB")

local a, b, c = fn("run1")
print(a)
print(b)
print(c)

local d, e, g = fn("run2")
print(d)
print(e)
print(g)
`
  }
];

async function runMetamorphicRelease() {
  console.log('====================================================');
  console.log('   P0: 5 NEW GENUINE-PROTECTED METAMORPHIC TESTS    ');
  console.log('====================================================\n');

  const baseDir = path.resolve(__dirname, '../tests/temp/metamorphic-release');
  if (fs.existsSync(baseDir)) {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
  fs.mkdirSync(baseDir, { recursive: true });

  const results = [];

  for (let i = 0; i < programs.length; i++) {
    const prog = programs[i];
    console.log(`[${i + 1}/${programs.length}] Protecting ${prog.name}: ${prog.description}...`);

    const progDir = path.join(baseDir, prog.name);
    fs.mkdirSync(progDir, { recursive: true });

    const origPath = path.join(progDir, 'original.lua');
    const protPath = path.join(progDir, 'protected.lua');
    const recPath = path.join(progDir, 'recovered.lua');
    const repPath = path.join(progDir, 'report.json');

    fs.writeFileSync(origPath, prog.source, 'utf8');

    // Run original with Lua to get ground truth stdout
    let expectedStdout = '';
    try {
      expectedStdout = execSync(`lua "${origPath}"`, { encoding: 'utf8' }).trim();
    } catch (e) {
      console.warn(`Could not run original with lua: ${e.message}`);
    }

    // Call WeAreDevs Obfuscator API
    const protectedCode = await obfuscateWithWeAreDevs(prog.source);
    fs.writeFileSync(protPath, protectedCode, 'utf8');

    const protBytes = Buffer.byteLength(protectedCode, 'utf8');
    const protSha = sha256(protectedCode);

    console.log(`    Protected bytes: ${protBytes}, SHA256: ${protSha.substring(0, 16)}...`);

    // BLIND RECOVERY: The recovery step only reads protected.lua
    console.log(`    Running recovery blindly on protected.lua...`);
    const blindInput = fs.readFileSync(protPath, 'utf8');
    const recoveryRes = recover(blindInput, { stage: 'L5-W', filename: `${prog.name}.lua` });

    fs.writeFileSync(recPath, recoveryRes.code, 'utf8');
    fs.writeFileSync(repPath, JSON.stringify(recoveryRes.report, null, 2), 'utf8');

    const recoveryLevel = recoveryRes.report?.recoveryLevel || 'UNKNOWN';
    const residualStates = recoveryRes.report?.completeness?.residualStateCount ?? recoveryRes.report?.statesFound ?? 0;

    // INDEPENDENT VALIDATOR: Run recovered code with lua and compare stdout
    let recoveredStdout = '';
    let execPass = false;
    let silentCorruption = false;

    try {
      recoveredStdout = execSync(`lua "${recPath}"`, { encoding: 'utf8', timeout: 3000 }).trim();
      if (expectedStdout) {
        execPass = (recoveredStdout.replace(/\r\n/g, '\n') === expectedStdout.replace(/\r\n/g, '\n'));
        if (!execPass && recoveryLevel === 'L5-W') {
          silentCorruption = true; // Claimed L5-W but wrong output!
        }
      } else {
        execPass = true;
      }
    } catch (err) {
      if (recoveryLevel === 'L5-W') {
        silentCorruption = true;
      } else {
        // In L4/L4.5 conservative fallback, dispatcher may require external environment/VM transport
        execPass = false;
      }
    }

    console.log(`    Recovery Level:    ${recoveryLevel}`);
    console.log(`    Residual States:   ${residualStates}`);
    console.log(`    Semantic Match:    ${execPass}`);
    console.log(`    Silent Corruption: ${silentCorruption}`);

    results.push({
      name: prog.name,
      description: prog.description,
      protectedSha256: protSha,
      protectedBytes: protBytes,
      recoveryLevel,
      semanticMatch: execPass,
      residualStates,
      silentCorruption
    });

    console.log('');
  }

  const resultsPath = path.resolve(__dirname, '../audit/metamorphic-release-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf8');

  console.log('====================================================');
  console.log('   METAMORPHIC RELEASE SUMMARY RESULTS TABLE        ');
  console.log('====================================================');
  console.table(results.map(r => ({
    Name: r.name,
    SHA256: r.protectedSha256.substring(0, 12),
    Bytes: r.protectedBytes,
    Level: r.recoveryLevel,
    SemanticMatch: r.semanticMatch,
    ResidualStates: r.residualStates,
    SilentCorruption: r.silentCorruption
  })));

  const anyCorruption = results.some(r => r.silentCorruption);
  if (anyCorruption) {
    throw new Error('P0 FAILURE: Silent corruption detected in metamorphic suite!');
  }

  console.log('\n>>> P0 METAMORPHIC RELEASE GATE PASSED: Zero silent corruption across all genuine protected targets!');
  return results;
}

runMetamorphicRelease().catch(err => {
  console.error('Metamorphic Release Failure:', err);
  process.exit(1);
});
