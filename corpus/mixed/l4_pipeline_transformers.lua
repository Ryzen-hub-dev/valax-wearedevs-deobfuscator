local function pipe(val, ...)
  local fns = { ... }
  for _, f in ipairs(fns) do val = f(val) end
  return val
end
print(pipe(5, function(x) return x * 2 end, function(x) return x + 3 end))