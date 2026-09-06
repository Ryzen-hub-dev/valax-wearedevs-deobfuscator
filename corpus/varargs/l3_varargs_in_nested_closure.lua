local function outer(...)
  local args = { ... }
  return function(idx) return args[idx] end
end
local getter = outer("x", "y", "z")
print(getter(2))