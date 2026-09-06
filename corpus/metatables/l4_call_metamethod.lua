local callable = setmetatable({ factor = 10 }, {
  __call = function(self, val) return self.factor * val end
})
print(callable(5))