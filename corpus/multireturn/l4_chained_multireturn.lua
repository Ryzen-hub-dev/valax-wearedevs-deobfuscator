local function f() return 1, 2 end
local function g(a, b) return a + 10, b + 20 end
local x, y = g(f())
print(x, y)