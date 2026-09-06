local function createAccount(initialBalance)
  local balance = initialBalance
  local transactions = 0

  local function deposit(amount)
    balance = balance + amount
    transactions = transactions + 1
    return balance
  end

  local function withdraw(amount)
    if balance >= amount then
      balance = balance - amount
      transactions = transactions + 1
      return true, balance
    else
      return false, balance
    end
  end

  local function getStats()
    return { balance = balance, transactions = transactions }
  end

  return deposit, withdraw, getStats
end

local dep, wth, stats = createAccount(100)
local b1 = dep(50)
local ok1, b2 = wth(30)
local ok2, b3 = wth(200)
local finalStats = stats()

local RESULT = {
  b1 = b1,
  ok1 = ok1,
  b2 = b2,
  ok2 = ok2,
  b3 = b3,
  finalStats = finalStats
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
