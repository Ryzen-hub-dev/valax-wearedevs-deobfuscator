local ops = {
  add = function(a, b) return a + b end,
  sub = function(a, b) return a - b end
}
print(ops.add(10, 5), ops.sub(10, 5))