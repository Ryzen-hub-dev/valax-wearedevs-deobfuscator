local fns = {}
local acc = 0
for i = 1, 3 do
  fns[i] = function(v) acc = acc + v; return acc end
end
print(fns[1](1), fns[2](2), fns[3](3))