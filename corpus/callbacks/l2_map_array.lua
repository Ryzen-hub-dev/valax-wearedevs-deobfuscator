local function map(t, fn)
  local res = {}
  for i, v in ipairs(t) do res[i] = fn(v) end
  return res
end
local out = map({1, 2, 3}, function(x) return x + 10 end)
print(out[1], out[2], out[3])