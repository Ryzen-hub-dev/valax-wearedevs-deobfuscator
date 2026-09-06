local function deepCopy(t)
    if type(t) ~= "table" then return t end
    local copy = {}
    for k, v in pairs(t) do
        copy[k] = deepCopy(v)
    end
    return copy
end
local orig = {sub = {val = 42}}
local c = deepCopy(orig)
c.sub.val = 99
print(orig.sub.val)
print(c.sub.val)