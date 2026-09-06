-- Metamorphic test 07: Closures, upvalues, and higher-order functions
local function makeAdder(base)
  local total = base
  return function(inc)
    total = total + inc
    return total
  end
end

local function compose(f, g)
  return function(...)
    return f(g(...))
  end
end

local add5 = makeAdder(5)
local r1 = add5(10)
local r2 = add5(20)

local double = function(x) return x * 2 end
local add5AndDouble = compose(double, add5)
local r3 = add5AndDouble(5)

print(r1, r2, r3)
