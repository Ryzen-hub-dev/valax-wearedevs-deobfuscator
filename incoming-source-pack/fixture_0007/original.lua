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
