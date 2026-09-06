local d = { a = 1, b = 2 }
local count = 0
for k, v in pairs(d) do count = count + 1 end
print(count)