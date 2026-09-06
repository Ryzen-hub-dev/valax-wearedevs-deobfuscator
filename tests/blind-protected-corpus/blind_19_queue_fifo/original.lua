local q = {items = {}, first = 1, last = 0}
local function push(val)
    q.last = q.last + 1
    q.items[q.last] = val
end
local function pop()
    if q.first > q.last then return nil end
    local val = q.items[q.first]
    q.first = q.first + 1
    return val
end
push("first")
push("second")
print(pop())
print(pop())