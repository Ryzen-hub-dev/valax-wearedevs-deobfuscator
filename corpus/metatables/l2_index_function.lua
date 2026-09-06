local obj = setmetatable({}, { __index = function(t, k) return "dynamic_" .. k end })
print(obj.foo, obj.bar)