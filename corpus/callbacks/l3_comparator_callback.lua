local t = { 3, 1, 4, 2 }
table.sort(t, function(a, b) return a < b end)
print(t[1], t[2], t[3], t[4])