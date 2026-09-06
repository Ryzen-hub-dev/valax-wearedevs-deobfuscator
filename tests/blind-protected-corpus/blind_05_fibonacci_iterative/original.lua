local a, b = 0, 1
for i = 1, 8 do
    local temp = a + b
    a = b
    b = temp
    print(a)
end