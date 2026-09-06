local t = setmetatable({ id = 99 }, {
  __tostring = function(self) return "ID:" .. self.id end
})
print(tostring(t))