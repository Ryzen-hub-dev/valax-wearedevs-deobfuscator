local prefix = "hi"

local function make(...)
    local args = {...}
    local count = 0

    return function(extra)
        count = count + 1

        if count == 1 then
            return prefix, args[1], extra
        end

        return prefix, args[2], extra
    end
end

local f = make("one", "two")

local a, b, c = f("x")
print(a)
print(b)
print(c)

local d, e, g = f("y")
print(d)
print(e)
print(g)
