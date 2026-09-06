local state = "INIT"
local cycles = 0
while state ~= "DONE" and cycles < 10 do
    cycles = cycles + 1
    if state == "INIT" then
        state = "WORK"
    elseif state == "WORK" then
        state = "DONE"
    end
end
print(cycles)
print(state)