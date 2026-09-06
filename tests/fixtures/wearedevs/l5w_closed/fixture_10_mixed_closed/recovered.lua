local v1 = "hi"
local function fn2(...)
  local t3 = { ... }
  local c4 = 0
  return function(p5)
    c4 = c4 + 1
    if c4 == 1 then
      return v1, t3[1], p5
    else
      return v1, t3[2], p5
    end
  end
end
local inst6 = fn2("one", "two")
local r7, r8, r9 = inst6("x")
print(r7)
print(r8)
print(r9)
local r10, r11, r12 = inst6("y")
print(r10)
print(r11)
print(r12)
