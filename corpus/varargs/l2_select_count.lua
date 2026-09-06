local function count(...) return select("#", ...) end
print(count("a", "b", "c", "d"))