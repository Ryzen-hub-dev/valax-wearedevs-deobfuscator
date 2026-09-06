local function filter(arr, pred)
    local res = {}
    for i = 1, #arr do
        if pred(arr[i]) then
            table.insert(res, arr[i])
        end
    end
    return res
end

local nums = {1, 4, 7, 10, 13, 16}
local evens = filter(nums, function(x) return x % 2 == 0 end)
for i = 1, #evens do
    print(evens[i])
end