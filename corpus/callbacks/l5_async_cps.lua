local function cps_add(a, b, k) return k(a + b) end
local function cps_mul(a, b, k) return k(a * b) end
cps_add(2, 3, function(sum)
  cps_mul(sum, 4, function(prod)
    print(prod)
  end)
end)