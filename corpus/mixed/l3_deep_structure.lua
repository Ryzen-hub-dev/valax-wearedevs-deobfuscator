local obj = {
  data = { 10, 20, 30 },
  calc = function(self) local s = 0; for _, v in ipairs(self.data) do s = s + v end; return s end
}
print(obj:calc())