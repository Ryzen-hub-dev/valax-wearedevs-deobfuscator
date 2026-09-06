local function divmod(a, b) return math.floor(a / b), a % b end
local d, m = divmod(17, 5)
print(d, m)