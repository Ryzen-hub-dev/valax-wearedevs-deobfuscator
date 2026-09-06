local function isPow2(n)
    if n <= 0 then return false end
    while n > 1 do
        if n % 2 ~= 0 then return false end
        n = n / 2
    end
    return true
end
print(isPow2(16))
print(isPow2(18))