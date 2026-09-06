local function eval(a, b, c, d)
    return (a and b) or (c and not d)
end
print(eval(true, false, true, false))
print(eval(false, false, true, true))
print(eval(true, true, false, false))