local tree = { val = 10, left = { val = 5 }, right = { val = 15 } }
local function sumTree(node)
  if not node then return 0 end
  return node.val + sumTree(node.left) + sumTree(node.right)
end
print(sumTree(tree))