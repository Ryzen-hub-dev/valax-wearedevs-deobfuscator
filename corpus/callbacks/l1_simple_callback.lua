local function run(cb) return cb(42) end
print(run(function(x) return x * 2 end))