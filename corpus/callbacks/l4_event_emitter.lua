local listeners = {}
local function on(evt, fn) listeners[evt] = fn end
local function emit(evt, val) if listeners[evt] then return listeners[evt](val) end end
on("data", function(d) return d * 3 end)
print(emit("data", 5))