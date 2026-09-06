local function map(t, fn)
    local out = {}
    for i = 1, #t do
        out[i] = fn(t[i])
    end
    return out
end
local r = map({2, 3, 4}, function(x) return x * x end)
for i = 1, #r do
    print(r[i])
end