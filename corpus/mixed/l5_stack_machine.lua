local stack = {}
local function push(v) table.insert(stack, v) end
local function pop() return table.remove(stack) end
push(10)
push(20)
local b, a = pop(), pop()
push(a + b)
print(pop())