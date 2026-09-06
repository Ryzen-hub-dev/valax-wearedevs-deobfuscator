const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

const SERIALIZER = `
local function __toJson(val)
  local t = type(val)
  if t == 'number' or t == 'boolean' then
    return tostring(val)
  elseif t == 'string' then
    return string.format('%q', val)
  elseif t == 'table' then
    local isArr = true
    local n = 0
    for k, v in pairs(val) do
      n = n + 1
      if type(k) ~= 'number' or k ~= n then isArr = false end
    end
    local parts = {}
    if isArr then
      for i = 1, #val do parts[i] = __toJson(val[i]) end
      return '[' .. table.concat(parts, ',') .. ']'
    else
      local keys = {}
      for k in pairs(val) do table.insert(keys, tostring(k)) end
      table.sort(keys)
      for i, k in ipairs(keys) do
        parts[i] = string.format('%q:%s', k, __toJson(val[k]))
      end
      return '{' .. table.concat(parts, ',') .. '}'
    end
  end
  return 'null'
end
`;

const fixtures = [
  {
    id: 'fixture_0002',
    name: 'arithmetic_branches',
    level: 3,
    title: 'Arithmetic + Branches',
    code: `
local a = -15
local b = 4
local c = 2.5

local mod = a % b
local arith = (a * b) / (c + 1.5) - (a + b)
local branches = { branch1 = 0, branch2 = 0, branch3 = 0, branch4 = 0 }

if arith > 0 and mod == 1 then
  branches.branch1 = branches.branch1 + 1
elseif arith < 0 and mod == 1 then
  branches.branch2 = branches.branch2 + 1
elseif arith == 0 or mod ~= 1 then
  branches.branch3 = branches.branch3 + 1
else
  branches.branch4 = branches.branch4 + 1
end

local booleanFlag = (a < 0) and (b > 0) and not (c < 0)

local RESULT = {
  values = { a, b, c, mod, arith },
  branchCounters = branches,
  flags = { booleanFlag = booleanFlag }
}
`
  },
  {
    id: 'fixture_0003',
    name: 'nested_closures',
    level: 4,
    title: 'Nested Closures & Mutable Captures',
    code: `
local function makeOuter(baseVal)
  local mutableCounter = 0
  local immutableMultiplier = 3

  local function innerAdder(inc)
    mutableCounter = mutableCounter + inc
    local function deepMultiplier(factor)
      return (baseVal + mutableCounter) * immutableMultiplier * factor
    end
    return deepMultiplier
  end

  return innerAdder
end

local outer1 = makeOuter(10)
local fn1 = outer1(5)
local res1 = fn1(2)
local fn2 = outer1(10)
local res2 = fn2(1)
local res3 = fn1(1)

local RESULT = {
  closureResults = { res1, res2, res3 },
  description = "nested closures with mutable captures"
}
`
  },
  {
    id: 'fixture_0004',
    name: 'tables_dynamic_keys',
    level: 3,
    title: 'Tables + Dynamic Keys',
    code: `
local t = { 10, 20, 30 }
t.name = "DynamicTable"
t["numeric_key_100"] = 100

for i = 1, 4 do
  local key = "comp_" .. (i * 2)
  t[key] = i * 15
end

t.nested = {
  innerKey = "inside",
  arr = { 1, 2, 3 }
}

t.calc = function(self, factor)
  return (self[1] + self[2] + self[3]) * factor
end

local computedValue = t:calc(2)

local RESULT = {
  arrayLen = #t,
  arrayValues = { t[1], t[2], t[3] },
  stringKeys = { name = t.name, numKey = t["numeric_key_100"] },
  dynamicKeys = { c2 = t.comp_2, c4 = t.comp_4, c6 = t.comp_6, c8 = t.comp_8 },
  nestedInner = t.nested.innerKey,
  calcResult = computedValue
}
`
  },
  {
    id: 'fixture_0005',
    name: 'loops',
    level: 3,
    title: 'Loop Constructs & Break Semantics',
    code: `
local whileI = 0
local whileSum = 0
while whileI < 5 do
  whileI = whileI + 1
  whileSum = whileSum + whileI
end

local repeatVal = 1
repeat
  repeatVal = repeatVal * 2
until repeatVal >= 16

local forSum = 0
for i = 1, 10, 2 do
  if i == 7 then
    break
  end
  forSum = forSum + i
end

local nestedHits = 0
for x = 1, 4 do
  for y = 1, 4 do
    if x == y then
      nestedHits = nestedHits + 1
      break
    end
  end
end

local RESULT = {
  whileSum = whileSum,
  repeatVal = repeatVal,
  forSum = forSum,
  nestedHits = nestedHits
}
`
  },
  {
    id: 'fixture_0006',
    name: 'varargs_multireturn',
    level: 4,
    title: 'Varargs & Multiple Return Truncation',
    code: `
local function multiRet(a, b, c)
  return a * 10, b * 20, c * 30
end

local function forwarder(...)
  local count = select("#", ...)
  local second = select(2, ...)
  return count, second
end

local x, y = multiRet(1, 2, 3)
local singleX = (multiRet(1, 2, 3))
local c1, c2 = forwarder(multiRet(1, 2, 3))

local function receiver(first, second, third)
  return { first = first, second = second, third = third }
end

local tbl = receiver(multiRet(4, 5, 6))

local RESULT = {
  truncated = { x = x, y = y },
  parenthesized = singleX,
  forwarded = { count = c1, second = c2 },
  received = tbl
}
`
  },
  {
    id: 'fixture_0007',
    name: 'callback_graph',
    level: 4,
    title: 'Callback Graph & Indirect Invocation',
    code: `
local function execute(cb, val)
  return cb(val)
end

local callbacks = {
  double = function(x) return x * 2 end,
  square = function(x) return x * x end,
  negate = function(x) return -x end
}

local function getCallback(mode)
  if mode == "d" then return callbacks.double
  elseif mode == "s" then return callbacks.square
  else return callbacks.negate end
end

local r1 = execute(getCallback("d"), 10)
local r2 = execute(getCallback("s"), 7)
local r3 = execute(getCallback("n"), 15)

local pipeline = { callbacks.double, callbacks.square, callbacks.negate }
local pipeVal = 3
for _, cb in ipairs(pipeline) do
  pipeVal = cb(pipeVal)
end

local RESULT = {
  direct = { r1 = r1, r2 = r2, r3 = r3 },
  pipelined = pipeVal
}
`
  },
  {
    id: 'fixture_0008',
    name: 'recursion_mutual',
    level: 4,
    title: 'Direct & Mutual Recursion',
    code: `
local function gcd(a, b)
  if b == 0 then return a else return gcd(b, a % b) end
end

local isEven, isOdd
isEven = function(n)
  if n == 0 then return true
  else return isOdd(n - 1) end
end

isOdd = function(n)
  if n == 0 then return false
  else return isEven(n - 1) end
end

local gcd1 = gcd(48, 18)
local gcd2 = gcd(101, 10)
local e4 = isEven(4)
local o4 = isOdd(4)
local e7 = isEven(7)
local o7 = isOdd(7)

local RESULT = {
  gcd = { gcd1 = gcd1, gcd2 = gcd2 },
  evenOdd = { e4 = e4, o4 = o4, e7 = e7, o7 = o7 }
}
`
  },
  {
    id: 'fixture_0009',
    name: 'boolean_control_flow',
    level: 4,
    title: 'Complex Boolean Control Flow & Short-Circuit Counters',
    code: `
local sideEffects = { a = 0, b = 0, c = 0, d = 0 }

local function checkA(ret) sideEffects.a = sideEffects.a + 1; return ret end
local function checkB(ret) sideEffects.b = sideEffects.b + 1; return ret end
local function checkC(ret) sideEffects.c = sideEffects.c + 1; return ret end
local function checkD(ret) sideEffects.d = sideEffects.d + 1; return ret end

local eval1 = checkA(false) and checkB(true)
local eval2 = checkC(true) or checkD(true)
local eval3 = (checkA(true) and checkB(false)) or (checkC(true) and not checkD(false))

local RESULT = {
  evaluations = { eval1 = eval1, eval2 = eval2, eval3 = eval3 },
  sideEffectCounters = sideEffects
}
`
  },
  {
    id: 'fixture_0010',
    name: 'shared_closure_state',
    level: 4,
    title: 'Shared Closure State across Multiple Handles',
    code: `
local function createAccount(initialBalance)
  local balance = initialBalance
  local transactions = 0

  local function deposit(amount)
    balance = balance + amount
    transactions = transactions + 1
    return balance
  end

  local function withdraw(amount)
    if balance >= amount then
      balance = balance - amount
      transactions = transactions + 1
      return true, balance
    else
      return false, balance
    end
  end

  local function getStats()
    return { balance = balance, transactions = transactions }
  end

  return deposit, withdraw, getStats
end

local dep, wth, stats = createAccount(100)
local b1 = dep(50)
local ok1, b2 = wth(30)
local ok2, b3 = wth(200)
local finalStats = stats()

local RESULT = {
  b1 = b1,
  ok1 = ok1,
  b2 = b2,
  ok2 = ok2,
  b3 = b3,
  finalStats = finalStats
}
`
  },
  {
    id: 'fixture_0011',
    name: 'mixed_stress_program',
    level: 5,
    title: 'Mixed Stress Program (All Constructs Combined)',
    code: `
local function createPipeline(...)
  local stages = { ... }
  local log = {}

  local function run(initialValue)
    local val = initialValue
    for i = 1, #stages do
      local stage = stages[i]
      table.insert(log, "stage_" .. i)
      if type(stage) == "function" then
        val = stage(val)
      elseif type(stage) == "table" and stage.transform then
        val = stage:transform(val)
      end
    end
    return val, log
  end

  return run
end

local stage1 = function(x) return x + 10 end
local stage2 = {
  factor = 3,
  transform = function(self, x) return x * self.factor end
}
local stage3 = function(x)
  local res = 0
  for i = 1, 3 do res = res + x * i end
  return res
end

local pipeline = createPipeline(stage1, stage2, stage3)
local outVal, outLog = pipeline(5)

local RESULT = {
  finalValue = outVal,
  executionLog = outLog
}
`
  }
];

function preparePack() {
  const packDir = path.resolve(__dirname, '../incoming-source-pack');
  if (!fs.existsSync(packDir)) fs.mkdirSync(packDir, { recursive: true });

  const manifest = {
    packVersion: 1,
    description: "Gate A: 10 Deterministic Original Lua Programs for WeAreDevs Protection Validation",
    totalFixtures: fixtures.length,
    fixtures: []
  };

  for (const f of fixtures) {
    const fDir = path.join(packDir, f.id);
    if (!fs.existsSync(fDir)) fs.mkdirSync(fDir, { recursive: true });

    // Build complete original.lua code with JSON output
    const fullCode = f.code.trim() + '\n' + SERIALIZER.trim() + '\nprint(__toJson(RESULT))\n';
    const origPath = path.join(fDir, 'original.lua');
    fs.writeFileSync(origPath, fullCode, 'utf8');

    // Run luajit to get expected JSON
    let expectedJsonStr = '';
    try {
      expectedJsonStr = execSync(`luajit "${origPath}"`).toString().trim();
    } catch (e) {
      console.error(`Error running ${f.id} under luajit:`, e.message);
    }

    const expectedObj = JSON.parse(expectedJsonStr);
    const expPath = path.join(fDir, 'expected.json');
    fs.writeFileSync(expPath, JSON.stringify(expectedObj, null, 2), 'utf8');

    const sourceHash = sha256(fullCode);
    const meta = {
      fixtureId: f.id,
      category: f.name,
      title: f.title,
      complexityLevel: f.level,
      language: 'lua',
      sourceHash,
      protectedSourceRequired: true,
      protectedGenerated: false,
      protectedFileName: 'protected.lua'
    };
    fs.writeFileSync(path.join(fDir, 'metadata.json'), JSON.stringify(meta, null, 2), 'utf8');

    const readme = `FIXTURE: ${f.id} (${f.title})
Complexity Level: ${f.level}/5
Source Hash (SHA-256): ${sourceHash}

INSTRUCTIONS FOR PROJECT OWNER:
1. Protect 'original.lua' using the authorized WeAreDevs obfuscator.
2. Save the resulting protected output file exactly as 'protected.lua' in this directory (${f.id}/protected.lua).
3. Once placed, run:
     node scripts/validate-gate-a.js
   The automated harness will detect the file, run deobfuscation, verify AST round-trip, and validate semantic equivalence against 'expected.json'.
`;
    fs.writeFileSync(path.join(fDir, 'README.txt'), readme, 'utf8');

    manifest.fixtures.push({
      fixtureId: f.id,
      category: f.name,
      title: f.title,
      complexityLevel: f.level,
      original: `${f.id}/original.lua`,
      expected: `${f.id}/expected.json`,
      metadata: `${f.id}/metadata.json`,
      protectedExpectedPath: `${f.id}/protected.lua`,
      protectedPresent: false
    });

    console.log(`Prepared ${f.id} (${f.title}) - Source hash: ${sourceHash.slice(0, 12)}...`);
  }

  fs.writeFileSync(path.join(packDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Successfully generated Gate A Source Pack with ${fixtures.length} fixtures in incoming-source-pack/.`);
}

if (require.main === module) {
  preparePack();
}

module.exports = { preparePack };
