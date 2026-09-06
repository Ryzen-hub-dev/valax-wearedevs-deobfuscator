local function bsearch(arr, target)
    local low, high = 1, #arr
    while low <= high do
        local mid = math.floor((low + high) / 2)
        if arr[mid] == target then
            return mid
        elseif arr[mid] < target then
            low = mid + 1
        else
            high = mid - 1
        end
    end
    return -1
end
local sorted = {10, 20, 30, 40, 50, 60, 70}
print(bsearch(sorted, 40))
print(bsearch(sorted, 25))