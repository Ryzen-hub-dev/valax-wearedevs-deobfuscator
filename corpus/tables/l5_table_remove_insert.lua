local t = {5, 2, 8, 1}
table.insert(t, 2, 99)
table.remove(t, 1)
print(#t, t[1], t[2])