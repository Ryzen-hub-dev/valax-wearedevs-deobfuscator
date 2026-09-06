local function range(from, to)
  local curr = from - 1
  return function() if curr < to then curr = curr + 1 return curr end end
end
local acc = 0
for n in range(5, 8) do acc = acc + n end
print(acc)