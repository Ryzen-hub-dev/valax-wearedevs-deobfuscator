local function inner(...) return select("#", ...) end
local function outer(...) return inner(...) end
print(outer(1, 2, 3, 4, 5))