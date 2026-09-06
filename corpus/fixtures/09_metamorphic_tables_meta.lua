-- Metamorphic test 09: Tables, metatables, custom indexing
local matrix = {
  { 1, 2, 3; 4 },
  { 5, 6, 7; 8 };
  extra = 99
}

local meta = {
  __index = function(tbl, key)
    return "default_" .. tostring(key)
  end,
  __call = function(tbl, x, y)
    return x + y
  end
}

local obj = setmetatable({}, meta)
local v1 = obj.missingProp
local v2 = obj(10, 20)

print(matrix[1][2], matrix.extra, v1, v2)
