local f, g
f = function(n) return n > 0 and g(n - 1) or 0 end
g = function(n) return n > 0 and f(n - 1) or 1 end
print(f(4), g(4))