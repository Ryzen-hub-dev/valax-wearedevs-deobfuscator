local text = "alpha beta gamma delta"
local count = 0
for word in string.gmatch(text, "%S+") do
    count = count + 1
end
print(count)