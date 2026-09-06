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
