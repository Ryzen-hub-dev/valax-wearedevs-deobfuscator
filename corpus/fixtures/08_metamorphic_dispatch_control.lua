-- Metamorphic test 08: Dispatch control flow, loops, breaks, nested branches
local state = 100
local accumulator = 0

while state > 0 do
  if state > 50 then
    if state % 2 == 0 then
      accumulator = accumulator + 2
      state = state - 10
    else
      accumulator = accumulator + 1
      state = state - 5
    end
  elseif state > 20 then
    for i = 1, 3 do
      accumulator = accumulator + i
    end
    state = state - 15
  else
    repeat
      accumulator = accumulator + state
      state = state - 5
    until state <= 0
    break
  end
end

print(accumulator)
