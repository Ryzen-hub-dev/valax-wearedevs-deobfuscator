local val = 1000
local iters = 0
repeat
    val = val / 2
    iters = iters + 1
until val < 20
print(iters)
print(math.floor(val))