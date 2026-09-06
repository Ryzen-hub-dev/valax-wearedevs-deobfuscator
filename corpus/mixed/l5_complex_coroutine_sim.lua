local function task(name, count)
  local i = 0
  return function()
    i = i + 1
    return i <= count and (name .. "_" .. i) or nil
  end
end
local t1, t2 = task("A", 2), task("B", 2)
print(t1(), t2(), t1(), t2(), t1() == nil)