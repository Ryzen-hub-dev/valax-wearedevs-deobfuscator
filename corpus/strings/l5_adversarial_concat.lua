local s = ""
for i = 1, 10 do s = s .. string.char(64 + i) end
print(s, #s)