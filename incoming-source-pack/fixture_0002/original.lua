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
