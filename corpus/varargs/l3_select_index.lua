local function pick(n, ...) return select(n, ...) end
print(pick(2, 100, 200, 300))