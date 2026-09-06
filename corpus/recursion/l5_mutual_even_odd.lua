local isEven, isOdd
isEven = function(n) if n == 0 then return true else return isOdd(n - 1) end end
isOdd = function(n) if n == 0 then return false else return isEven(n - 1) end end
print(isEven(4), isOdd(4))