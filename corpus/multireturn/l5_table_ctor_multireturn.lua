local function ret2() return 5, 6 end
local t = { 1, ret2() }
print(#t, t[1], t[2], t[3])