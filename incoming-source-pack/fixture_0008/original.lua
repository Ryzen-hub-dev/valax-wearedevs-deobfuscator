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
