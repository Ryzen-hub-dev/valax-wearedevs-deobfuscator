local function level1(a)
  return function(b)
    return function(c)
      return a + b + c
    end
  end
end
print(level1(1)(2)(3))