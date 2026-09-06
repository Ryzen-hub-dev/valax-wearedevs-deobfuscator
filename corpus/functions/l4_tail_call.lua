local function tail(n, acc)
  if n <= 0 then return acc end
  return tail(n - 1, acc + n)
end
print(tail(5, 0))