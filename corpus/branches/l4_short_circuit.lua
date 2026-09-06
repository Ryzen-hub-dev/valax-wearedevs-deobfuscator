local flag = true
local v = flag and 100 or 200
local w = (not flag) and 300 or 400
print(v, w)