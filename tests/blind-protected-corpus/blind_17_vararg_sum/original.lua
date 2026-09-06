local function sumAll(...)
    local total = 0
    local n = select('#', ...)
    for i = 1, n do
        total = total + select(i, ...)
    end
    return total
end
print(sumAll(10, 20, 30, 40))