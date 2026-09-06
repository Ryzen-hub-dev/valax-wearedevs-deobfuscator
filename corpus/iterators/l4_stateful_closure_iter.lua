local function countUp(limit)
  local i = 0
  return function()
    if i < limit then i = i + 1; return i end
  end
end
local out = {}
for n in countUp(3) do table.insert(out, n) end
print(#out, out[1], out[3])