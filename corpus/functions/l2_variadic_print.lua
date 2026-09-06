local function wrap(f, ...) return f(...) end
local function sum(a, b, c) return a + b + c end
print(wrap(sum, 1, 2, 3))