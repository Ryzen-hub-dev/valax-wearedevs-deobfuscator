local t = { a = 1, b = 2, [3] = 4 }
local function makeCounter()
  local count = 0
  return function()
    count = count + 1
    return count
  end
end
local c = makeCounter()
print(c())
