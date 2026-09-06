local Vec = {}
Vec.__index = Vec
function Vec.new(x, y) return setmetatable({x=x, y=y}, Vec) end
function Vec.__add(a, b) return Vec.new(a.x + b.x, a.y + b.y) end
local v1, v2 = Vec.new(1, 2), Vec.new(3, 4)
local v3 = v1 + v2
print(v3.x, v3.y)