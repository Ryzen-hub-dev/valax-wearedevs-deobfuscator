local function minmax(a, b) return a < b and a or b, a > b and a or b end
local min, max = minmax(10, 5)
print(min, max)