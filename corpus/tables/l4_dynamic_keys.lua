local t = {}
for i = 1, 5 do t["k" .. i] = i * 10 end
print(t.k3, t.k5)