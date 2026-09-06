local function mix(a, b, ...) local t = { ... } return a + b + #t end
print(mix(10, 20, 1, 2, 3))