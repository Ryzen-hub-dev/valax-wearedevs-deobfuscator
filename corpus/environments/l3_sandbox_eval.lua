local env = { val = 50, res = 0 }
local f = function() res = val * 2 end
setfenv(f, env)
f()
print(env.res)