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
