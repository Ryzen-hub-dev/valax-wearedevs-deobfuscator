local function makeAcc(start)
    local val = start
    return function(step)
        val = val + step
        return val
    end
end
local acc = makeAcc(100)
print(acc(15))
print(acc(25))