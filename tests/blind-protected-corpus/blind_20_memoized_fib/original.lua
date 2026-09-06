local memo = {}
local function fib(n)
    if n <= 1 then return n end
    if memo[n] then return memo[n] end
    local res = fib(n - 1) + fib(n - 2)
    memo[n] = res
    return res
end
print(fib(10))