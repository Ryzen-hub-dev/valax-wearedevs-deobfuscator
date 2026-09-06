local data = {1, 2, 3, 4, 5}
local sum = 0
for _, v in ipairs(data) do
    local doubled = v * 2
    local inc = doubled + 1
    sum = sum + inc
end
print(sum)