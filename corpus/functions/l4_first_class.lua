local function apply(f, val) return f(val) end
local function inc(n) return n + 1 end
print(apply(inc, 10))