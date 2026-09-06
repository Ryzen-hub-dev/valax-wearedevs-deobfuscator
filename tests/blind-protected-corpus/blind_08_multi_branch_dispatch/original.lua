local function categorize(x)
    if x < 0 then
        return "negative"
    elseif x == 0 then
        return "zero"
    elseif x <= 10 then
        return "small"
    else
        return "large"
    end
end
print(categorize(-5))
print(categorize(0))
print(categorize(7))
print(categorize(42))