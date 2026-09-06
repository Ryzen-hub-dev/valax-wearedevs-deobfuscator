local function makeAdder(x)
  return function(y) return x + y end
end
local a5 = makeAdder(5)
print(a5(10))