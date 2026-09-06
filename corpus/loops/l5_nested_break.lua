local hits = 0
for i = 1, 5 do for j = 1, 5 do if i == j then hits = hits + 1 break end end end
print(hits)