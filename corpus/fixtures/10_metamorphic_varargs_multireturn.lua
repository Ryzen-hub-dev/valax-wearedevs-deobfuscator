-- Metamorphic test 10: Varargs and multi-return
local function multiReturn(a, b, c)
  return a * 10, b * 20, c * 30
end

local function collectVarargs(...)
  local count = select("#", ...)
  local first = select(1, ...)
  return count, first
end

local x, y, z = multiReturn(1, 2, 3)
local n, f = collectVarargs("a", "b", "c", "d")

print(x + y + z, n, f)
