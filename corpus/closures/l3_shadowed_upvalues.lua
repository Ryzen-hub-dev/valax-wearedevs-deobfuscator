local x = 1
local function f()
  local x = 2
  return function() return x end
end
print(f()(), x)