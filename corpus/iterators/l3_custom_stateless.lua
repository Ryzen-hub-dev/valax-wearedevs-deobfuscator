local function square_iter(max, current)
  if current < max then
    current = current + 1
    return current, current * current
  end
end
local function squares(max) return square_iter, max, 0 end
local sum = 0
for i, sq in squares(4) do sum = sum + sq end
print(sum)