local words = {}
for w in string.gmatch("alpha beta gamma", "%a+") do table.insert(words, w) end
print(#words, words[1], words[3])