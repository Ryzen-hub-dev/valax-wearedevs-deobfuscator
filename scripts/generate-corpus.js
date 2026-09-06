const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

const categories = {
  arithmetic: [
    { level: 1, name: 'l1_simple_add', code: 'local a = 10 + 20\nprint(a)' },
    { level: 2, name: 'l2_precedence', code: 'local x = 5 + 3 * 2 - (8 / 4)\nprint(x)' },
    { level: 3, name: 'l3_nested_floats', code: 'local p = (12.5 * 4.2) / (2.1 + 0.9) + (-15 % 4)\nprint(p)' },
    { level: 4, name: 'l4_bitwise_ops', code: 'local a, b = 0x0F, 0xF0\nlocal c = (a + b) * 2\nprint(c)' },
    { level: 5, name: 'l5_adversarial_expr', code: 'local x = - - -5 + 10 * -2 - (-3 * -4) + (2 ^ 3)\nprint(x)' },
    { level: 2, name: 'l2_parallel_assign', code: 'local a, b, c = 1, 2, 3\na, b, c = b + c, a + c, a + b\nprint(a, b, c)' }
  ],
  strings: [
    { level: 1, name: 'l1_concat', code: 'local s = "hello " .. "world"\nprint(s)' },
    { level: 2, name: 'l2_escapes', code: 'local s = "Line1\\nLine2\\t\\\"Quoted\\\""\nprint(#s)' },
    { level: 3, name: 'l3_byte_escapes', code: 'local bin = "\\97\\98\\99\\0\\100"\nprint(#bin, string.byte(bin, 1, 5))' },
    { level: 4, name: 'l4_string_sub_format', code: 'local fmt = string.format("%s=%d", "val", 42)\nlocal sub = string.sub(fmt, 1, 3)\nprint(fmt, sub)' },
    { level: 5, name: 'l5_adversarial_concat', code: 'local s = ""\nfor i = 1, 10 do s = s .. string.char(64 + i) end\nprint(s, #s)' },
    { level: 2, name: 'l2_multiline_string', code: 'local str = [[multi\nline\ntext]]\nprint(#str)' }
  ],
  tables: [
    { level: 1, name: 'l1_array', code: 'local t = {10, 20, 30}\nprint(t[1], t[2], #t)' },
    { level: 2, name: 'l2_dict', code: 'local d = { name = "Valax", version = 4 }\nprint(d.name, d["version"])' },
    { level: 3, name: 'l3_nested', code: 'local grid = { {1, 2}, {3, 4} }\nprint(grid[2][1], grid[1][2])' },
    { level: 4, name: 'l4_dynamic_keys', code: 'local t = {}\nfor i = 1, 5 do t["k" .. i] = i * 10 end\nprint(t.k3, t.k5)' },
    { level: 5, name: 'l5_table_remove_insert', code: 'local t = {5, 2, 8, 1}\ntable.insert(t, 2, 99)\ntable.remove(t, 1)\nprint(#t, t[1], t[2])' },
    { level: 2, name: 'l2_mixed_separators', code: 'local t = { 1, 2; a = 3, b = 4; }\nprint(t[1], t.a)' },
    { level: 4, name: 'l4_sparse_array', code: 'local t = {}\nt[10] = "ten"\nt[100] = "hundred"\nprint(t[10], t[100], t[50] == nil)' }
  ],
  branches: [
    { level: 1, name: 'l1_simple_if', code: 'local x = 10\nif x > 5 then print("gt") else print("le") end' },
    { level: 2, name: 'l2_elseif_ladder', code: 'local x = 15\nif x < 10 then print("low") elseif x < 20 then print("mid") else print("high") end' },
    { level: 3, name: 'l3_nested_branches', code: 'local a, b = 5, 10\nif a > 0 then if b > 5 then print("both") end end' },
    { level: 4, name: 'l4_short_circuit', code: 'local flag = true\nlocal v = flag and 100 or 200\nlocal w = (not flag) and 300 or 400\nprint(v, w)' },
    { level: 5, name: 'l5_adversarial_ternary', code: 'local a, b, c = 1, 2, 3\nlocal r = (a < b and b < c) and (a + b) or (b + c)\nprint(r)' },
    { level: 2, name: 'l2_truthiness', code: 'local val = 0\nif val then print("zero_is_truthy") else print("falsy") end' }
  ],
  loops: [
    { level: 1, name: 'l1_while', code: 'local i = 0\nwhile i < 5 do i = i + 1 end\nprint(i)' },
    { level: 2, name: 'l2_repeat_until', code: 'local count = 1\nrepeat count = count * 2 until count >= 16\nprint(count)' },
    { level: 3, name: 'l3_numeric_for', code: 'local sum = 0\nfor i = 1, 10, 2 do sum = sum + i end\nprint(sum)' },
    { level: 4, name: 'l4_loop_break', code: 'local found = nil\nfor i = 1, 100 do if i * i == 49 then found = i; break end end\nprint(found)' },
    { level: 5, name: 'l5_nested_break', code: 'local hits = 0\nfor i = 1, 5 do for j = 1, 5 do if i == j then hits = hits + 1 break end end end\nprint(hits)' },
    { level: 3, name: 'l3_negative_step_for', code: 'local total = 0\nfor i = 10, 1, -3 do total = total + i end\nprint(total)' }
  ],
  functions: [
    { level: 1, name: 'l1_simple_call', code: 'local function add(a, b) return a + b end\nprint(add(3, 7))' },
    { level: 2, name: 'l2_named_anonymous', code: 'local mul = function(a, b) return a * b end\nprint(mul(4, 5))' },
    { level: 3, name: 'l3_nested_funcs', code: 'local function outer(x)\n  local function inner(y) return x * y end\n  return inner(3)\nend\nprint(outer(5))' },
    { level: 4, name: 'l4_first_class', code: 'local function apply(f, val) return f(val) end\nlocal function inc(n) return n + 1 end\nprint(apply(inc, 10))' },
    { level: 5, name: 'l5_function_table_dispatch', code: 'local ops = {\n  add = function(a, b) return a + b end,\n  sub = function(a, b) return a - b end\n}\nprint(ops.add(10, 5), ops.sub(10, 5))' },
    { level: 2, name: 'l2_variadic_print', code: 'local function wrap(f, ...) return f(...) end\nlocal function sum(a, b, c) return a + b + c end\nprint(wrap(sum, 1, 2, 3))' },
    { level: 4, name: 'l4_tail_call', code: 'local function tail(n, acc)\n  if n <= 0 then return acc end\n  return tail(n - 1, acc + n)\nend\nprint(tail(5, 0))' }
  ],
  closures: [
    { level: 1, name: 'l1_basic_closure', code: 'local function makeAdder(x)\n  return function(y) return x + y end\nend\nlocal a5 = makeAdder(5)\nprint(a5(10))' },
    { level: 2, name: 'l2_mutable_capture', code: 'local function makeCounter()\n  local c = 0\n  return function() c = c + 1; return c end\nend\nlocal cnt = makeCounter()\nprint(cnt(), cnt(), cnt())' },
    { level: 3, name: 'l3_multiple_closures_same_upval', code: 'local function makePair()\n  local val = 10\n  local get = function() return val end\n  local set = function(v) val = v end\n  return get, set\nend\nlocal g, s = makePair()\ns(42)\nprint(g())' },
    { level: 4, name: 'l4_nested_closure_chain', code: 'local function level1(a)\n  return function(b)\n    return function(c)\n      return a + b + c\n    end\n  end\nend\nprint(level1(1)(2)(3))' },
    { level: 5, name: 'l5_closure_generator_table', code: 'local function gen(n)\n  local fns = {}\n  for i = 1, n do\n    local captured = i\n    fns[i] = function() return captured * 10 end\n  end\n  return fns\nend\nlocal t = gen(3)\nprint(t[1](), t[2](), t[3]())' },
    { level: 3, name: 'l3_shadowed_upvalues', code: 'local x = 1\nlocal function f()\n  local x = 2\n  return function() return x end\nend\nprint(f()(), x)' },
    { level: 4, name: 'l4_shared_mutable_loops', code: 'local fns = {}\nlocal acc = 0\nfor i = 1, 3 do\n  fns[i] = function(v) acc = acc + v; return acc end\nend\nprint(fns[1](1), fns[2](2), fns[3](3))' },
    { level: 5, name: 'l5_cross_closure_recursion', code: 'local f, g\nf = function(n) return n > 0 and g(n - 1) or 0 end\ng = function(n) return n > 0 and f(n - 1) or 1 end\nprint(f(4), g(4))' }
  ],
  callbacks: [
    { level: 1, name: 'l1_simple_callback', code: 'local function run(cb) return cb(42) end\nprint(run(function(x) return x * 2 end))' },
    { level: 2, name: 'l2_map_array', code: 'local function map(t, fn)\n  local res = {}\n  for i, v in ipairs(t) do res[i] = fn(v) end\n  return res\nend\nlocal out = map({1, 2, 3}, function(x) return x + 10 end)\nprint(out[1], out[2], out[3])' },
    { level: 3, name: 'l3_filter_reduce', code: 'local function reduce(t, init, fn)\n  local acc = init\n  for _, v in ipairs(t) do acc = fn(acc, v) end\n  return acc\nend\nprint(reduce({1, 2, 3, 4}, 0, function(a, b) return a + b end))' },
    { level: 4, name: 'l4_event_emitter', code: 'local listeners = {}\nlocal function on(evt, fn) listeners[evt] = fn end\nlocal function emit(evt, val) if listeners[evt] then return listeners[evt](val) end end\non("data", function(d) return d * 3 end)\nprint(emit("data", 5))' },
    { level: 5, name: 'l5_async_cps', code: 'local function cps_add(a, b, k) return k(a + b) end\nlocal function cps_mul(a, b, k) return k(a * b) end\ncps_add(2, 3, function(sum)\n  cps_mul(sum, 4, function(prod)\n    print(prod)\n  end)\nend)' },
    { level: 3, name: 'l3_comparator_callback', code: 'local t = { 3, 1, 4, 2 }\ntable.sort(t, function(a, b) return a < b end)\nprint(t[1], t[2], t[3], t[4])' }
  ],
  recursion: [
    { level: 1, name: 'l1_factorial', code: 'local function fact(n) if n <= 1 then return 1 else return n * fact(n - 1) end end\nprint(fact(5))' },
    { level: 2, name: 'l2_fibonacci', code: 'local function fib(n) if n <= 1 then return n else return fib(n - 1) + fib(n - 2) end end\nprint(fib(7))' },
    { level: 3, name: 'l3_ackermann_small', code: 'local function ack(m, n)\n  if m == 0 then return n + 1\n  elseif n == 0 then return ack(m - 1, 1)\n  else return ack(m - 1, ack(m, n - 1))\n  end\nend\nprint(ack(2, 2))' },
    { level: 4, name: 'l4_tree_sum', code: 'local tree = { val = 10, left = { val = 5 }, right = { val = 15 } }\nlocal function sumTree(node)\n  if not node then return 0 end\n  return node.val + sumTree(node.left) + sumTree(node.right)\nend\nprint(sumTree(tree))' },
    { level: 5, name: 'l5_mutual_even_odd', code: 'local isEven, isOdd\nisEven = function(n) if n == 0 then return true else return isOdd(n - 1) end end\nisOdd = function(n) if n == 0 then return false else return isEven(n - 1) end end\nprint(isEven(4), isOdd(4))' },
    { level: 2, name: 'l2_gcd', code: 'local function gcd(a, b) return b == 0 and a or gcd(b, a % b) end\nprint(gcd(48, 18))' }
  ],
  varargs: [
    { level: 1, name: 'l1_pack_varargs', code: 'local function pack(...) return { ... } end\nlocal t = pack(10, 20, 30)\nprint(#t, t[2])' },
    { level: 2, name: 'l2_select_count', code: 'local function count(...) return select("#", ...) end\nprint(count("a", "b", "c", "d"))' },
    { level: 3, name: 'l3_select_index', code: 'local function pick(n, ...) return select(n, ...) end\nprint(pick(2, 100, 200, 300))' },
    { level: 4, name: 'l4_pass_varargs', code: 'local function inner(...) return select("#", ...) end\nlocal function outer(...) return inner(...) end\nprint(outer(1, 2, 3, 4, 5))' },
    { level: 5, name: 'l5_mixed_params_varargs', code: 'local function mix(a, b, ...) local t = { ... } return a + b + #t end\nprint(mix(10, 20, 1, 2, 3))' },
    { level: 3, name: 'l3_varargs_in_nested_closure', code: 'local function outer(...)\n  local args = { ... }\n  return function(idx) return args[idx] end\nend\nlocal getter = outer("x", "y", "z")\nprint(getter(2))' }
  ],
  multireturn: [
    { level: 1, name: 'l1_two_values', code: 'local function minmax(a, b) return a < b and a or b, a > b and a or b end\nlocal min, max = minmax(10, 5)\nprint(min, max)' },
    { level: 2, name: 'l2_unpack_table', code: 'local t = { 10, 20, 30 }\nlocal a, b, c = unpack(t)\nprint(a, b, c)' },
    { level: 3, name: 'l3_discard_values', code: 'local function three() return 1, 2, 3 end\nlocal _, mid = three()\nprint(mid)' },
    { level: 4, name: 'l4_chained_multireturn', code: 'local function f() return 1, 2 end\nlocal function g(a, b) return a + 10, b + 20 end\nlocal x, y = g(f())\nprint(x, y)' },
    { level: 5, name: 'l5_table_ctor_multireturn', code: 'local function ret2() return 5, 6 end\nlocal t = { 1, ret2() }\nprint(#t, t[1], t[2], t[3])' },
    { level: 2, name: 'l2_return_expr_tuple', code: 'local function divmod(a, b) return math.floor(a / b), a % b end\nlocal d, m = divmod(17, 5)\nprint(d, m)' }
  ],
  metatables: [
    { level: 1, name: 'l1_index_fallback', code: 'local proto = { greeting = "hello" }\nlocal obj = setmetatable({}, { __index = proto })\nprint(obj.greeting)' },
    { level: 2, name: 'l2_index_function', code: 'local obj = setmetatable({}, { __index = function(t, k) return "dynamic_" .. k end })\nprint(obj.foo, obj.bar)' },
    { level: 3, name: 'l3_add_operator', code: 'local Vec = {}\nVec.__index = Vec\nfunction Vec.new(x, y) return setmetatable({x=x, y=y}, Vec) end\nfunction Vec.__add(a, b) return Vec.new(a.x + b.x, a.y + b.y) end\nlocal v1, v2 = Vec.new(1, 2), Vec.new(3, 4)\nlocal v3 = v1 + v2\nprint(v3.x, v3.y)' },
    { level: 4, name: 'l4_call_metamethod', code: 'local callable = setmetatable({ factor = 10 }, {\n  __call = function(self, val) return self.factor * val end\n})\nprint(callable(5))' },
    { level: 5, name: 'l5_tostring_concat', code: 'local t = setmetatable({ id = 99 }, {\n  __tostring = function(self) return "ID:" .. self.id end\n})\nprint(tostring(t))' },
    { level: 2, name: 'l2_newindex_guard', code: 'local store = {}\nlocal proxy = setmetatable({}, {\n  __newindex = function(t, k, v) store[k] = v * 2 end,\n  __index = store\n})\nproxy.a = 5\nprint(store.a)' }
  ],
  iterators: [
    { level: 1, name: 'l1_ipairs', code: 'local t = {10, 20, 30}\nlocal s = 0\nfor i, v in ipairs(t) do s = s + v end\nprint(s)' },
    { level: 2, name: 'l2_pairs', code: 'local d = { a = 1, b = 2 }\nlocal count = 0\nfor k, v in pairs(d) do count = count + 1 end\nprint(count)' },
    { level: 3, name: 'l3_custom_stateless', code: 'local function square_iter(max, current)\n  if current < max then\n    current = current + 1\n    return current, current * current\n  end\nend\nlocal function squares(max) return square_iter, max, 0 end\nlocal sum = 0\nfor i, sq in squares(4) do sum = sum + sq end\nprint(sum)' },
    { level: 4, name: 'l4_stateful_closure_iter', code: 'local function countUp(limit)\n  local i = 0\n  return function()\n    if i < limit then i = i + 1; return i end\n  end\nend\nlocal out = {}\nfor n in countUp(3) do table.insert(out, n) end\nprint(#out, out[1], out[3])' },
    { level: 5, name: 'l5_chain_iterators', code: 'local function range(from, to)\n  local curr = from - 1\n  return function() if curr < to then curr = curr + 1 return curr end end\nend\nlocal acc = 0\nfor n in range(5, 8) do acc = acc + n end\nprint(acc)' },
    { level: 2, name: 'l2_string_gmatch', code: 'local words = {}\nfor w in string.gmatch("alpha beta gamma", "%a+") do table.insert(words, w) end\nprint(#words, words[1], words[3])' }
  ],
  environments: [
    { level: 1, name: 'l1_global_get', code: 'local m = math.abs(-42)\nprint(m)' },
    { level: 2, name: 'l2_env_override', code: 'local myEnv = { print = print, x = 100 }\nsetfenv(1, myEnv)\nprint(x)' },
    { level: 3, name: 'l3_sandbox_eval', code: 'local env = { val = 50, res = 0 }\nlocal f = function() res = val * 2 end\nsetfenv(f, env)\nf()\nprint(env.res)' },
    { level: 4, name: 'l4_global_inheritance', code: 'local base = { x = 10, print = print }\nlocal env = setmetatable({}, { __index = base })\nlocal f = function() print(x) end\nsetfenv(f, env)\nf()' },
    { level: 5, name: 'l5_shadow_builtin', code: 'local orig_type = type\nlocal function custom_type(v) return "custom:" .. orig_type(v) end\nprint(custom_type(123))' },
    { level: 2, name: 'l2_pcall_isolation', code: 'local status, res = pcall(function() return 10 / 2 end)\nprint(status, res)' }
  ],
  mixed: [
    { level: 1, name: 'l1_func_table_loop', code: 'local t = {}\nfor i = 1, 3 do table.insert(t, i * i) end\nprint(#t, t[2])' },
    { level: 2, name: 'l2_closure_table_metamethod', code: 'local function create(id)\n  return setmetatable({id = id}, {\n    __tostring = function(s) return "Item_" .. s.id end\n  })\nend\nprint(tostring(create(7)))' },
    { level: 3, name: 'l3_deep_structure', code: 'local obj = {\n  data = { 10, 20, 30 },\n  calc = function(self) local s = 0; for _, v in ipairs(self.data) do s = s + v end; return s end\n}\nprint(obj:calc())' },
    { level: 4, name: 'l4_event_driven_fsm', code: 'local state = "init"\nlocal fsm = {\n  init = function() state = "running"; return state end,\n  running = function() state = "done"; return state end\n}\nprint(fsm[state](), fsm[state]())' },
    { level: 5, name: 'l5_stack_machine', code: 'local stack = {}\nlocal function push(v) table.insert(stack, v) end\nlocal function pop() return table.remove(stack) end\npush(10)\npush(20)\nlocal b, a = pop(), pop()\npush(a + b)\nprint(pop())' },
    { level: 3, name: 'l3_memoized_recursive', code: 'local memo = {}\nlocal function fibM(n)\n  if n <= 1 then return n end\n  if memo[n] then return memo[n] end\n  memo[n] = fibM(n - 1) + fibM(n - 2)\n  return memo[n]\nend\nprint(fibM(8))' },
    { level: 4, name: 'l4_pipeline_transformers', code: 'local function pipe(val, ...)\n  local fns = { ... }\n  for _, f in ipairs(fns) do val = f(val) end\n  return val\nend\nprint(pipe(5, function(x) return x * 2 end, function(x) return x + 3 end))' },
    { level: 5, name: 'l5_complex_coroutine_sim', code: 'local function task(name, count)\n  local i = 0\n  return function()\n    i = i + 1\n    return i <= count and (name .. "_" .. i) or nil\n  end\nend\nlocal t1, t2 = task("A", 2), task("B", 2)\nprint(t1(), t2(), t1(), t2(), t1() == nil)' }
  ],
  luau: [
    { level: 1, name: 'l1_type_annotations_comment', code: '--!strict\nlocal x: number = 42\nprint(x)' },
    { level: 2, name: 'l2_compound_assignment', code: 'local a = 10\na += 5\na *= 2\nprint(a)' },
    { level: 3, name: 'l3_if_expression', code: 'local flag = true\nlocal v = if flag then "yes" else "no"\nprint(v)' },
    { level: 4, name: 'l4_string_interpolation', code: 'local name = "Valax"\nlocal ver = 4\nlocal msg = `Engine {name} v{ver}`\nprint(msg)' },
    { level: 5, name: 'l5_typed_table_construction', code: 'type Point = { x: number, y: number }\nlocal p: Point = { x = 10, y = 20 }\nprint(p.x + p.y)' },
    { level: 2, name: 'l2_continue_statement', code: 'local s = 0\nfor i = 1, 5 do\n  if i == 3 then continue end\n  s += i\nend\nprint(s)' },
    { level: 4, name: 'l4_nested_if_expr', code: 'local score = 85\nlocal grade = if score >= 90 then "A" elseif score >= 80 then "B" else "C"\nprint(grade)' }
  ]
};

function generateCorpus() {
  const baseDir = path.resolve(__dirname, '../corpus');
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  const manifest = {
    totalPrograms: 0,
    categories: {},
    programs: []
  };

  let total = 0;

  for (const [catName, progs] of Object.entries(categories)) {
    const catDir = path.join(baseDir, catName);
    if (!fs.existsSync(catDir)) {
      fs.mkdirSync(catDir, { recursive: true });
    }

    manifest.categories[catName] = progs.length;

    for (const p of progs) {
      total++;
      const fileName = `${p.name}.lua`;
      const filePath = path.join(catDir, fileName);
      fs.writeFileSync(filePath, p.code, 'utf8');

      const meta = {
        fixtureId: `${catName}_${p.name}`,
        sourceCategory: catName,
        complexityLevel: p.level,
        language: catName === 'luau' ? 'luau' : 'lua',
        protectionVariant: 'original',
        sourceHash: sha256(p.code),
        protectedHash: null,
        filePath: path.relative(path.resolve(__dirname, '..'), filePath)
      };

      manifest.programs.push(meta);
    }
  }

  manifest.totalPrograms = total;

  const manifestPath = path.join(baseDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Successfully generated ${total} semantic corpus programs across ${Object.keys(categories).length} categories.`);
  return manifest;
}

if (require.main === module) {
  generateCorpus();
}

module.exports = { generateCorpus };
