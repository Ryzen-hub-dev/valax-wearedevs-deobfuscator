local orig_type = type
local function custom_type(v) return "custom:" .. orig_type(v) end
print(custom_type(123))