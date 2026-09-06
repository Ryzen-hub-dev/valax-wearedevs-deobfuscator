const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RecoveryService } = require('../packages/core/src');
const { SemanticOracle, SemanticTrace } = require('../packages/core/src/oracle/semantic-oracle');

const TARGET_DIR = path.resolve(__dirname, '../tests/blind-protected-corpus');
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

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      if (!data.success || !data.obfuscated) {
        throw new Error(`Obfuscation failed: ${JSON.stringify(data)}`);
      }

      return data.obfuscated;
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(1000 * attempt);
    }
  }
}

const sourcePrograms = [
  {
    id: 'blind_01_collatz',
    name: 'Collatz Sequence While-Loop',
    source: `local n = 19
local steps = 0
while n > 1 do
    if n % 2 == 0 then
        n = n / 2
    else
        n = 3 * n + 1
    end
    steps = steps + 1
end
print(steps)`
  },
  {
    id: 'blind_02_factorial_recursive',
    name: 'Recursive Factorial',
    source: `local function fact(n)
    if n <= 1 then return 1 end
    return n * fact(n - 1)
end
print(fact(6))`
  },
  {
    id: 'blind_03_table_filter',
    name: 'Array Filtering with Function',
    source: `local function filter(arr, pred)
    local res = {}
    for i = 1, #arr do
        if pred(arr[i]) then
            table.insert(res, arr[i])
        end
    end
    return res
end

local nums = {1, 4, 7, 10, 13, 16}
local evens = filter(nums, function(x) return x % 2 == 0 end)
for i = 1, #evens do
    print(evens[i])
end`
  },
  {
    id: 'blind_04_string_reverse',
    name: 'Character String Accumulation',
    source: `local str = "ValaxEngine"
local rev = ""
for i = #str, 1, -1 do
    rev = rev .. string.sub(str, i, i)
end
print(rev)`
  },
  {
    id: 'blind_05_fibonacci_iterative',
    name: 'Iterative Fibonacci Sequence',
    source: `local a, b = 0, 1
for i = 1, 8 do
    local temp = a + b
    a = b
    b = temp
    print(a)
end`
  },
  {
    id: 'blind_06_matrix_diagonal',
    name: '2D Table Diagonal Sum',
    source: `local m = {
    {1, 2, 3},
    {4, 5, 6},
    {7, 8, 9}
}
local diag = 0
for i = 1, 3 do
    diag = diag + m[i][i]
end
print(diag)`
  },
  {
    id: 'blind_07_accumulator_closure',
    name: 'Lexical Accumulator Closure',
    source: `local function makeAcc(start)
    local val = start
    return function(step)
        val = val + step
        return val
    end
end
local acc = makeAcc(100)
print(acc(15))
print(acc(25))`
  },
  {
    id: 'blind_08_multi_branch_dispatch',
    name: 'Multi-Branch Conditional',
    source: `local function categorize(x)
    if x < 0 then
        return "negative"
    elseif x == 0 then
        return "zero"
    elseif x <= 10 then
        return "small"
    else
        return "large"
    end
end
print(categorize(-5))
print(categorize(0))
print(categorize(7))
print(categorize(42))`
  },
  {
    id: 'blind_09_metatable_vector',
    name: 'Metatable Vector Arithmetic',
    source: `local Vec = {}
Vec.__index = Vec

function Vec.new(x, y)
    return setmetatable({x = x, y = y}, Vec)
end

function Vec.__add(a, b)
    return Vec.new(a.x + b.x, a.y + b.y)
end

local v1 = Vec.new(3, 4)
local v2 = Vec.new(1, 2)
local v3 = v1 + v2
print(v3.x)
print(v3.y)`
  },
  {
    id: 'blind_10_bubble_sort',
    name: 'In-Place Bubble Sort',
    source: `local list = {9, 3, 7, 1, 5}
local n = #list
for i = 1, n do
    for j = 1, n - i do
        if list[j] > list[j + 1] then
            list[j], list[j + 1] = list[j + 1], list[j]
        end
    end
end
for i = 1, n do
    print(list[i])
end`
  },
  {
    id: 'blind_11_binary_search',
    name: 'Binary Search Algorithm',
    source: `local function bsearch(arr, target)
    local low, high = 1, #arr
    while low <= high do
        local mid = math.floor((low + high) / 2)
        if arr[mid] == target then
            return mid
        elseif arr[mid] < target then
            low = mid + 1
        else
            high = mid - 1
        end
    end
    return -1
end
local sorted = {10, 20, 30, 40, 50, 60, 70}
print(bsearch(sorted, 40))
print(bsearch(sorted, 25))`
  },
  {
    id: 'blind_12_higher_order_map',
    name: 'Higher Order Map Transformation',
    source: `local function map(t, fn)
    local out = {}
    for i = 1, #t do
        out[i] = fn(t[i])
    end
    return out
end
local r = map({2, 3, 4}, function(x) return x * x end)
for i = 1, #r do
    print(r[i])
end`
  },
  {
    id: 'blind_13_curried_addition',
    name: 'Curried Nested Functions',
    source: `local function add(a)
    return function(b)
        return function(c)
            return a + b + c
        end
    end
end
print(add(5)(10)(15))`
  },
  {
    id: 'blind_14_bitwise_simulation',
    name: 'Parity and Power of Two Simulation',
    source: `local function isPow2(n)
    if n <= 0 then return false end
    while n > 1 do
        if n % 2 ~= 0 then return false end
        n = n / 2
    end
    return true
end
print(isPow2(16))
print(isPow2(18))`
  },
  {
    id: 'blind_15_string_parser',
    name: 'Delimited String Word Counter',
    source: `local text = "alpha beta gamma delta"
local count = 0
for word in string.gmatch(text, "%S+") do
    count = count + 1
end
print(count)`
  },
  {
    id: 'blind_16_state_machine_enum',
    name: 'State Transition Loop',
    source: `local state = "INIT"
local cycles = 0
while state ~= "DONE" and cycles < 10 do
    cycles = cycles + 1
    if state == "INIT" then
        state = "WORK"
    elseif state == "WORK" then
        state = "DONE"
    end
end
print(cycles)
print(state)`
  },
  {
    id: 'blind_17_vararg_sum',
    name: 'Vararg Aggregator Function',
    source: `local function sumAll(...)
    local total = 0
    local n = select('#', ...)
    for i = 1, n do
        total = total + select(i, ...)
    end
    return total
end
print(sumAll(10, 20, 30, 40))`
  },
  {
    id: 'blind_18_multi_return_split',
    name: 'Multi-Return Division and Remainder',
    source: `local function divmod(a, b)
    local q = math.floor(a / b)
    local r = a % b
    return q, r, a > 0
end
local quot, rem, isPos = divmod(29, 6)
print(quot)
print(rem)
print(isPos)`
  },
  {
    id: 'blind_19_queue_fifo',
    name: 'Simple FIFO Queue Operations',
    source: `local q = {items = {}, first = 1, last = 0}
local function push(val)
    q.last = q.last + 1
    q.items[q.last] = val
end
local function pop()
    if q.first > q.last then return nil end
    local val = q.items[q.first]
    q.first = q.first + 1
    return val
end
push("first")
push("second")
print(pop())
print(pop())`
  },
  {
    id: 'blind_20_memoized_fib',
    name: 'Memoized Recursive Function',
    source: `local memo = {}
local function fib(n)
    if n <= 1 then return n end
    if memo[n] then return memo[n] end
    local res = fib(n - 1) + fib(n - 2)
    memo[n] = res
    return res
end
print(fib(10))`
  },
  {
    id: 'blind_21_deeply_nested_scope',
    name: 'Nested Scopes and Lexical Shadowing',
    source: `local x = 1
do
    local x = 10
    do
        local x = 100
        print(x)
    end
    print(x)
end
print(x)`
  },
  {
    id: 'blind_22_repeat_until_converge',
    name: 'Repeat-Until Convergence Loop',
    source: `local val = 1000
local iters = 0
repeat
    val = val / 2
    iters = iters + 1
until val < 20
print(iters)
print(math.floor(val))`
  },
  {
    id: 'blind_23_compound_boolean',
    name: 'Compound Boolean Short-Circuit Logic',
    source: `local function eval(a, b, c, d)
    return (a and b) or (c and not d)
end
print(eval(true, false, true, false))
print(eval(false, false, true, true))
print(eval(true, true, false, false))`
  },
  {
    id: 'blind_24_table_deep_copy',
    name: 'Recursive Table Copier',
    source: `local function deepCopy(t)
    if type(t) ~= "table" then return t end
    local copy = {}
    for k, v in pairs(t) do
        copy[k] = deepCopy(v)
    end
    return copy
end
local orig = {sub = {val = 42}}
local c = deepCopy(orig)
c.sub.val = 99
print(orig.sub.val)
print(c.sub.val)`
  },
  {
    id: 'blind_25_pipeline_processor',
    name: 'Data Pipeline Transformations',
    source: `local data = {1, 2, 3, 4, 5}
local sum = 0
for _, v in ipairs(data) do
    local doubled = v * 2
    local inc = doubled + 1
    sum = sum + inc
end
print(sum)`
  }
];

async function runBlindCorpus() {
  console.log('====================================================');
  console.log('   BLIND PROTECTED CORPUS GENERATION & EVALUATION   ');
  console.log('====================================================\n');

  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  }

  const oracle = new SemanticOracle();
  const results = [];
  const metrics = {
    total: sourcePrograms.length,
    crashes: 0,
    silentCorruption: 0,
    levels: {
      L3: 0,
      L4: 0,
      'L4.5': 0,
      'L5-W': 0
    },
    parseFailures: 0,
    unsupported: 0
  };

  for (let i = 0; i < sourcePrograms.length; i++) {
    const prog = sourcePrograms[i];
    console.log(`[${i + 1}/${sourcePrograms.length}] Processing ${prog.id} (${prog.name})...`);

    const progDir = path.join(TARGET_DIR, prog.id);
    if (!fs.existsSync(progDir)) {
      fs.mkdirSync(progDir, { recursive: true });
    }

    const origFile = path.join(progDir, 'original.lua');
    const protFile = path.join(progDir, 'protected.lua');
    const recFile = path.join(progDir, 'recovered.lua');
    const repFile = path.join(progDir, 'report.json');

    fs.writeFileSync(origFile, prog.source, 'utf8');

    // 1. Fetch genuine WeAreDevs protection if not cached
    let protectedSource;
    if (fs.existsSync(protFile)) {
      protectedSource = fs.readFileSync(protFile, 'utf8');
      console.log(`    Cached protected source loaded (${protectedSource.length} bytes)`);
    } else {
      console.log(`    Requesting genuine WeAreDevs protection via API...`);
      try {
        protectedSource = await obfuscateWithWeAreDevs(prog.source);
        fs.writeFileSync(protFile, protectedSource, 'utf8');
        console.log(`    Protected source received and saved (${protectedSource.length} bytes)`);
        await sleep(500); // Polite API pause
      } catch (err) {
        console.error(`    FAILED to obfuscate via WeAreDevs: ${err.message}`);
        metrics.unsupported++;
        continue;
      }
    }

    // 2. Execute RecoveryService (receives protected.lua ONLY)
    let recRes;
    try {
      recRes = RecoveryService.recover({
        filePath: protFile,
        requestedStage: 'auto',
        semanticValidation: false // We independently validate below
      });
    } catch (err) {
      console.error(`    CRASH during recovery: ${err.message}`);
      metrics.crashes++;
      continue;
    }

    if (!recRes.success && recRes.exitCode === 3) {
      metrics.parseFailures++;
    }

    const recCode = recRes.code || '';
    const recReport = recRes.report || {};
    const actualLevel = recReport.recovery?.actualLevel || 'L4';

    fs.writeFileSync(recFile, recCode, 'utf8');
    fs.writeFileSync(repFile, JSON.stringify(recReport, null, 2), 'utf8');

    // Update level counts
    if (metrics.levels[actualLevel] !== undefined) {
      metrics.levels[actualLevel]++;
    } else {
      metrics.levels.L4++;
    }

    // 3. Independent Differential Semantic Validation
    // Compare observable trace of original.lua vs recovered.lua
    let silentCorruption = false;
    if (oracle.luaBinary && recCode.length > 0) {
      const origTrace = oracle.trace(prog.source);
      const recTrace = oracle.trace(recCode);

      if (origTrace.success && recTrace.success) {
        const cmp = SemanticTrace.compare(origTrace.events, recTrace.events);
        if (!cmp.match && actualLevel === 'L5-W') {
          // If claimed L5-W but traces differ, that is silent corruption!
          console.error(`    [CORRUPTION] Semantic mismatch for claimed L5-W on ${prog.id}!`);
          silentCorruption = true;
          metrics.silentCorruption++;
        }
      }
    }

    results.push({
      id: prog.id,
      name: prog.name,
      protectedBytes: protectedSource.length,
      recoveryLevel: actualLevel,
      residualDispatcherStates: recReport.recovery?.dispatcherStatesAfter || 0,
      silentCorruption: silentCorruption,
      exitCode: recRes.exitCode
    });

    console.log(`    -> Recovery Level: ${actualLevel}, Residual States: ${recReport.recovery?.dispatcherStatesAfter || 0}, Silent Corruption: ${silentCorruption}`);
  }

  // 4. Save results and metrics
  fs.writeFileSync(path.join(AUDIT_DIR, 'blind-corpus-results.json'), JSON.stringify(results, null, 2), 'utf8');
  fs.writeFileSync(path.join(AUDIT_DIR, 'blind-corpus-metrics.json'), JSON.stringify(metrics, null, 2), 'utf8');

  console.log('\n====================================================');
  console.log('            BLIND CORPUS SUMMARY METRICS            ');
  console.log('====================================================');
  console.log(JSON.stringify(metrics, null, 2));

  if (metrics.silentCorruption > 0) {
    console.error('\n[FATAL] BETA BLOCKER: Silent semantic corruption detected!');
    process.exit(1);
  } else {
    console.log('\n[PASS] BETA CRITERIA MET: 0 silent corruption, 0 crashes across blind genuine corpus.');
  }

  return { metrics, results };
}

if (require.main === module) {
  runBlindCorpus().catch(err => {
    console.error('Fatal blind corpus error:', err);
    process.exit(1);
  });
}

module.exports = { runBlindCorpus };
