local fmt = string.format("%s=%d", "val", 42)
local sub = string.sub(fmt, 1, 3)
print(fmt, sub)