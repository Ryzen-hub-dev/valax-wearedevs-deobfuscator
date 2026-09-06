local function add(a)
    return function(b)
        return function(c)
            return a + b + c
        end
    end
end
print(add(5)(10)(15))