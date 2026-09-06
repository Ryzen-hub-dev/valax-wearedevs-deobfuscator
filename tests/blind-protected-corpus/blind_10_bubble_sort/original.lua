local list = {9, 3, 7, 1, 5}
local n = #list
for i = 1, n do
    for j = 1, n - i do
        if list[j] > list[j + 1] then
            list[j], list[j + 1] = list[j + 1], list[j]
        end
    end
end
for i = 1, n do
    print(list[i])
end