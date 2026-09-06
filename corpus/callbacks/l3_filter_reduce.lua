local function reduce(t, init, fn)
  local acc = init
  for _, v in ipairs(t) do acc = fn(acc, v) end
  return acc
end
print(reduce({1, 2, 3, 4}, 0, function(a, b) return a + b end))