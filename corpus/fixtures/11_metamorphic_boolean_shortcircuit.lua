-- Metamorphic test 11: Boolean logic, truthiness, short-circuit
local a = 0
local b = ""
local c = false
local d = nil

local res1 = a and "zero_is_truthy" or "wrong"
local res2 = b and "empty_string_is_truthy" or "wrong"
local res3 = c and "wrong" or "false_is_falsy"
local res4 = d and "wrong" or "nil_is_falsy"

local complex = (10 > 5 and not false) and (0 or 42) or (nil or "fallback")

print(res1, res2, res3, res4, complex)
