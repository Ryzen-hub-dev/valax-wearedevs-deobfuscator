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
