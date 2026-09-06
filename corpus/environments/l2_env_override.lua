local myEnv = { print = print, x = 100 }
setfenv(1, myEnv)
print(x)