local function outer()
    local function inner()
        return "hi"
    end

    return inner()
end

print(outer())
