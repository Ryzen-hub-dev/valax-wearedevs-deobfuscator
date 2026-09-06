local function pack(...) return { ... } end
local t = pack(10, 20, 30)
print(#t, t[2])