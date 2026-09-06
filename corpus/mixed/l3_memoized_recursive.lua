local memo = {}
local function fibM(n)
  if n <= 1 then return n end
  if memo[n] then return memo[n] end
  memo[n] = fibM(n - 1) + fibM(n - 2)
  return memo[n]
end
print(fibM(8))