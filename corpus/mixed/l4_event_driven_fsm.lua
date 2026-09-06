local state = "init"
local fsm = {
  init = function() state = "running"; return state end,
  running = function() state = "done"; return state end
}
print(fsm[state](), fsm[state]())