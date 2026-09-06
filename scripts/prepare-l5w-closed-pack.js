const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

const baseDir = path.resolve(__dirname, '../tests/fixtures/wearedevs/l5w_closed');

const fixtures = [
  {
    id: 'fixture_01_local_constant',
    name: 'Local Constant',
    description: 'Deterministic local constant string printed to stdout',
    original: `local x = "hi"
print(x)
`,
    expected: `print("hi")
`
  },
  {
    id: 'fixture_02_function_return',
    name: 'Function Return',
    description: 'Local non-escaping function returning constant string',
    original: `local function f()
    return "hi"
end

print(f())
`,
    expected: `local function f()
    return "hi"
end

print(f())
`
  },
  {
    id: 'fixture_03_constant_branch',
    name: 'Constant Branch',
    description: 'Statically proven constant branch condition folding dead alternate path',
    original: `local x = true

if x then
    print("hi")
else
    print("bye")
end
`,
    expected: `print("hi")
`
  },
  {
    id: 'fixture_04_numeric_loop',
    name: 'Numeric Loop',
    description: 'Closed deterministic numeric for-loop structure preservation',
    original: `for i = 1, 3 do
    print(i)
end
`,
    expected: `for i = 1, 3 do
    print(i)
end
`
  },
  {
    id: 'fixture_05_nested_function',
    name: 'Nested Function',
    description: 'Nested closure execution returning constant string',
    original: `local function outer()
    local function inner()
        return "hi"
    end

    return inner()
end

print(outer())
`,
    expected: `local function outer()
    local function inner()
        return "hi"
    end

    return inner()
end

print(outer())
`
  },
  {
    id: 'fixture_06_table_access',
    name: 'Table Access',
    description: 'Local non-escaping table constructor with property indexing',
    original: `local t = {
    message = "hi",
    value = 5
}

print(t.message)
`,
    expected: `local t = {
    message = "hi",
    value = 5
}

print(t.message)
`
  },
  {
    id: 'fixture_07_multireturn',
    name: 'Multiple Returns',
    description: 'Function returning multiple values assigned into multiple local variables',
    original: `local function values()
    return "hi", 42
end

local a, b = values()
print(a)
print(b)
`,
    expected: `local function values()
    return "hi", 42
end

local a, b = values()
print(a)
print(b)
`
  },
  {
    id: 'fixture_08_varargs',
    name: 'Varargs',
    description: 'Vararg function extracting leading argument',
    original: `local function first(...)
    local a = ...
    return a
end

print(first("hi", "unused"))
`,
    expected: `local function first(...)
    local a = ...
    return a
end

print(first("hi", "unused"))
`
  },
  {
    id: 'fixture_09_closure_capture',
    name: 'Closure Capture',
    description: 'Lexical closure capturing local upvalue from parent scope',
    original: `local message = "hi"

local function f()
    return message
end

print(f())
`,
    expected: `local message = "hi"

local function f()
    return message
end

print(f())
`
  },
  {
    id: 'fixture_10_mixed_closed',
    name: 'Mixed Closed Program',
    description: 'Complex closed deterministic program combining constants, tables, loops, branches, closures, and multi-returns',
    original: `local function createCounter(start)
    local count = start
    return function(step)
        count = count + step
        return count
    end
end

local function compute(val)
    local config = {
        mult = 2,
        offset = 10
    }
    local res = (val * config.mult) + config.offset
    return res, config.offset
end

local stepFn = createCounter(0)
local total = 0

for i = 1, 4 do
    local nextVal = stepFn(i)
    if nextVal > 5 then
        total = total + nextVal
    else
        total = total + (nextVal * 2)
    end
end

local finalVal, baseOffset = compute(total)
print(finalVal)
print(baseOffset)
`,
    expected: `local function createCounter(start)
    local count = start
    return function(step)
        count = count + step
        return count
    end
end

local function compute(val)
    local config = {
        mult = 2,
        offset = 10
    }
    local res = (val * config.mult) + config.offset
    return res, config.offset
end

local stepFn = createCounter(0)
local total = 0

for i = 1, 4 do
    local nextVal = stepFn(i)
    if nextVal > 5 then
        total = total + nextVal
    else
        total = total + (nextVal * 2)
    end
end

local finalVal, baseOffset = compute(total)
print(finalVal)
print(baseOffset)
`
  }
];

if (!fs.existsSync(baseDir)) {
  fs.mkdirSync(baseDir, { recursive: true });
}

for (const fix of fixtures) {
  const fixDir = path.join(baseDir, fix.id);
  if (!fs.existsSync(fixDir)) {
    fs.mkdirSync(fixDir, { recursive: true });
  }

  const origPath = path.join(fixDir, 'original.lua');
  const expPath = path.join(fixDir, 'expected.lua');
  const metaPath = path.join(fixDir, 'metadata.json');

  fs.writeFileSync(origPath, fix.original, 'utf8');
  fs.writeFileSync(expPath, fix.expected, 'utf8');

  const meta = {
    id: fix.id,
    name: fix.name,
    fixtureType: 'CLOSED_DETERMINISTIC_GROUND_TRUTH',
    pairedOriginalAvailable: true,
    semanticEligible: true,
    targetLevel: 'L5-W',
    originalBytes: Buffer.byteLength(fix.original, 'utf8'),
    originalSha256: sha256(fix.original),
    protectedAvailable: false,
    description: fix.description
  };

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  console.log(`Prepared fixture ${fix.id}: original.lua, expected.lua, metadata.json`);
}

console.log('\\nAll 10 L5-W closed deterministic fixtures prepared successfully.');
