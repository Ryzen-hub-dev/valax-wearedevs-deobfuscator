local function makePair()
  local val = 10
  local get = function() return val end
  local set = function(v) val = v end
  return get, set
end
local g, s = makePair()
s(42)
print(g())