local function gen(n)
  local fns = {}
  for i = 1, n do
    local captured = i
    fns[i] = function() return captured * 10 end
  end
  return fns
end
local t = gen(3)
print(t[1](), t[2](), t[3]())