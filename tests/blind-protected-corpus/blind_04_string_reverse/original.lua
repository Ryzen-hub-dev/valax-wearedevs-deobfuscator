local str = "ValaxEngine"
local rev = ""
for i = #str, 1, -1 do
    rev = rev .. string.sub(str, i, i)
end
print(rev)