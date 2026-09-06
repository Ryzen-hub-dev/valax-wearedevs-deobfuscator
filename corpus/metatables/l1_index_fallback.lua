local proto = { greeting = "hello" }
local obj = setmetatable({}, { __index = proto })
print(obj.greeting)