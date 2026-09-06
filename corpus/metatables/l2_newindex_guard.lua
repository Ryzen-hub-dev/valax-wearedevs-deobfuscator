local store = {}
local proxy = setmetatable({}, {
  __newindex = function(t, k, v) store[k] = v * 2 end,
  __index = store
})
proxy.a = 5
print(store.a)