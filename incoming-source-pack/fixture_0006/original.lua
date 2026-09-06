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
