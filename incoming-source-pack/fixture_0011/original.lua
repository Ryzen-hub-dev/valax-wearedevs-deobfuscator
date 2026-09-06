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
