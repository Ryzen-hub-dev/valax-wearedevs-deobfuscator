local a, b, c = 1, 2, 3
local r = (a < b and b < c) and (a + b) or (b + c)
print(r)