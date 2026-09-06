local x = 1
do
    local x = 10
    do
        local x = 100
        print(x)
    end
    print(x)
end
print(x)