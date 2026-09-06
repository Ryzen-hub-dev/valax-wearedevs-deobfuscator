local function create(id)
  return setmetatable({id = id}, {
    __tostring = function(s) return "Item_" .. s.id end
  })
end
print(tostring(create(7)))