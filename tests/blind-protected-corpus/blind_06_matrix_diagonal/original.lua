local m = {
    {1, 2, 3},
    {4, 5, 6},
    {7, 8, 9}
}
local diag = 0
for i = 1, 3 do
    diag = diag + m[i][i]
end
print(diag)