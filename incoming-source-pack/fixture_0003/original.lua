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
print(__toJson(RESULT))
