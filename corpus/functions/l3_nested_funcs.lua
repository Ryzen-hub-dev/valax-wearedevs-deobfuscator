local function outer(x)
  local function inner(y) return x * y end
  return inner(3)
end
print(outer(5))