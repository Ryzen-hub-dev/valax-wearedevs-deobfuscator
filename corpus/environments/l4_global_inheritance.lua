local base = { x = 10, print = print }
local env = setmetatable({}, { __index = base })
local f = function() print(x) end
setfenv(f, env)
f()