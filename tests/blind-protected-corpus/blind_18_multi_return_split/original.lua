local function divmod(a, b)
    local q = math.floor(a / b)
    local r = a % b
    return q, r, a > 0
end
local quot, rem, isPos = divmod(29, 6)
print(quot)
print(rem)
print(isPos)