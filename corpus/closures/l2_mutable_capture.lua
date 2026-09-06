local function makeCounter()
  local c = 0
  return function() c = c + 1; return c end
end
local cnt = makeCounter()
print(cnt(), cnt(), cnt())