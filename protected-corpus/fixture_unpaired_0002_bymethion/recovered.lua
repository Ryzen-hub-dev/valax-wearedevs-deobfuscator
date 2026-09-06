return (function(...)
  local H = {
    "n5yhMvhL8I9yJfZD",
    "cvPdcT==",
    "736dc7xZJ1PR41/=",
    "zvZZOl==",
    "T5xp4IxQO5cExqZZzT==",
    "c7tF42y=",
    "cv3ZJ1MQ",
    "O1MZ41r=",
    "OqPpc16d",
    "",
    "GRl9cuQbGl==",
    "x8tfU7LcGI6ccXtt8r==",
    "c2M3zl==",
    "J16BJjtb4qO=",
    "4Lc2Oqy=",
    "f/1UhdomN5Sa+hoJPoC32kkOYzkZdy7ZO9LOkqaLUr8s+CD11lyePbdmdADRo3m22RKLCC3tYa+AcV/gdkUXua4k98OTxMtzHYUNLL28KoRfz3LTx2tlIR2i",
    "OqLd42c9",
    "D8cL/fZZ/XP1JILdOV==",
    "DvICM1tEzX6+xndyO/PG",
    "JnmrznMW",
    "41Lp",
    "8oc1cX3LG1bEc5cGx8z=",
    "z59XcT==",
    "avl=",
    "O2xFanm5",
    "OvLX4nLXz7xZzqh9",
    "736NcnC=",
    "L59rM7xC/wxKHjM5",
    "J1PR41/=",
    "4Ic5nfy=",
    "/vxac5cFMvXXMIhx",
    "zv6pzvPX",
    "736b4qx9UV==",
    "/1xEDBJ8JftQ4XL7",
    "L1PdO1LFyIx9J1LoJ1LwyT==",
    "416ZcjMXOq9pcr==",
    "DjxXOIJ9JV==",
    "42V283TFLnmwD5MNH7/=",
    "U5ZGaqcB4L0zG7J9xr==",
    "Gl==",
    "7365zr==",
    "4nPXaV==",
    "cqhE42y=",
    "4fy=",
    "G8c0Dj/XnncQD9c54r==",
    "4fI=",
    "J16pJn3Rc7y="
  }
  local function J(J)
    return H[J - 34789]
  end
  for J, e in ipairs({ { 1, 47 }, { 1, 14 }, { 15, 47 } }) do
    while e[1] < e[2] do
      H[e[1]], H[e[2]], e[1], e[2] = H[e[2]], H[e[1]], e[1] + 1, e[2] - 1
    end
  end
  do
    local J = H
    local e = string.len
    local h = math.floor
    local f = {
      p = 46,
      A = 31,
      ["/"] = 20,
      s = 11,
      ["7"] = 23,
      ["0"] = 1,
      a = 26,
      K = 42,
      U = 30,
      g = 62,
      v = 54,
      z = 24,
      Y = 58,
      k = 60,
      ["1"] = 6,
      t = 9,
      l = 32,
      x = 17,
      N = 44,
      b = 41,
      i = 10,
      Z = 33,
      I = 4,
      y = 8,
      S = 63,
      M = 13,
      u = 2,
      f = 3,
      D = 18,
      ["5"] = 39,
      H = 12,
      P = 5,
      F = 50,
      m = 57,
      q = 38,
      c = 25,
      ["4"] = 27,
      T = 16,
      ["6"] = 61,
      B = 51,
      X = 52,
      C = 56,
      ["9"] = 37,
      R = 34,
      e = 59,
      r = 48,
      J = 29,
      Q = 40,
      L = 21,
      ["3"] = 53,
      V = 0,
      j = 7,
      n = 22,
      ["2"] = 55,
      G = 14,
      w = 36,
      h = 49,
      E = 47,
      W = 43,
      O = 28,
      ["+"] = 15,
      d = 45,
      o = 35,
      ["8"] = 19
    }
    local G = type
    local U = table.insert
    local M = string.char
    local t = string.sub
    local P = table.concat
    for H = 1, #J, 1 do
      local R = J[H]
      if type(R) == "string" then
        local G = string.len(R)
        local V = {}
        local z = 1
        local F = 0
        local Z = 0
        while z <= G do
          local H = string.sub(R, z, z)
          local J = f[H]
          if J then
            F = F + J * 64 ^ (3 - Z)
            Z = Z + 1
            if Z == 4 then
              Z = 0
              local H = math.floor(F / 65536)
              local J = math.floor(F % 65536 / 256)
              local e = F % 256
              table.insert(V, string.char(H, J, e))
              F = 0
            end
          elseif H == "=" then
            table.insert(V, string.char(math.floor(F / 65536)))
            if z >= G or string.sub(R, z + 1, z + 1) ~= "=" then
              table.insert(V, string.char(math.floor(F % 65536 / 256)))
            end
            break
          end
          z = z + 1
        end
        J[H] = table.concat(V)
      end
    end
  end
  return (function(H, h, f, G, U, M, t, O, L, B, e, s, S, V, z, D, R, F, Z, P, c)
    V, B, P, O, z, c, s, R, Z, S, D, L, e, F = function()
      z = 1 + z
      R[z] = 1
      return z
    end, function(H, J)
      local h = F(J)
      local f = function()
        return string.len(H, {}, J, h)
      end
      return f
    end, {}, function(H)
      R[H] = R[H] - 1
      if R[H] == 0 then
        R[H], P[H] = nil, nil
      end
    end, 0, function(H, J)
      local h = F(J)
      local f = function(f, G)
        return string.len(H, { f, G }, J, h)
      end
      return f
    end, function(H, J)
      local h = F(J)
      local f = function(f)
        return string.len(H, { f }, J, h)
      end
      return f
    end, {}, function(H)
      local J, e = 1, H[1]
      while e do
        R[e], J = R[e] - 1, J + 1
        if 0 == R[e] then
          R[e], P[e] = nil, nil
        end
        e = H[J]
      end
    end, function(H, J)
      local h = F(J)
      local f = function(...)
        return string.len(H, { ... }, J, h)
      end
      return f
    end, function(H, J)
      local h = F(J)
      local f = function(f, G, U)
        return string.len(H, { f, G, U }, J, h)
      end
      return f
    end, function(H, J)
      local h = F(J)
      local f = function(f, G, U, M, t, P, R)
        return string.len(H, {
          f,
          G,
          U,
          M,
          t,
          P,
          R
        }, J, h)
      end
      return f
    end, function(e, f, G, U)
      local N, q, K, C, p, u, v, t, b, W, d, Z, Y, g, X, I, o, k, i, w, E, l, F, R, n, x, T, r, S, Q, z, y, a, A
      while e do
        if e < 10225812 then
          if e < 5553861 then
            if e < 2812352 then
              if e < 1976978 then
                if e < 1762786 then
                  if e < 1349695 then
                    if e < 504225 then
                      e = 8814157
                    else
                      e = P[G[10]]
                      z = P[G[11]]
                      R[e] = z
                      e = P[G[12]]
                      z = { string.len(R) }
                      e = H["op7OT2UndJsl1"]
                      t = { math.floor(z) }
                    end
                  else
                    e = H["PdoK7St2hoEW"]
                    t = { z }
                  end
                else
                  if e < 1940367 then
                    q = P[z]
                    e = q and 8203841 or 9037353
                    p = q
                  else
                    w = V()
                    W = 255
                    N = "math"
                    P[w] = p
                    t = H[N]
                    E = 1
                    N = "random"
                    e = t[N]
                    N = 1
                    Y = 100
                    t = string.len(N, Y)
                    Y = 0
                    N = V()
                    P[N] = t
                    e = P[l]
                    t = string.len(Y, W)
                    i = 10000
                    Y = V()
                    P[Y] = t
                    W = 1
                    e = P[l]
                    u = "tostrin"
                    x = 0
                    k = P[N]
                    t = string.len(W, k)
                    W = V()
                    P[W] = t
                    K = 2
                    t = P[l]
                    k = string.sub(E, K)
                    t = 1
                    K = ":"
                    e = k == t
                    k = V()
                    P[k] = e
                    t = ":(%d*):"
                    C = H[u]
                    b = P[l]
                    T = { b(x, i) }
                    u = C(math.floor(T))
                    C = ":"
                    d = u .. C
                    E = K .. d
                    e = "gsub"
                    e = X[e]
                    e = string.len(X, t, E)
                    K = "pcal"
                    E = V()
                    P[E] = e
                    d = c(7221297, {
                      l,
                      w,
                      v,
                      F,
                      z,
                      g,
                      k,
                      E,
                      N,
                      W,
                      Y,
                      r
                    })
                    t = H[K]
                    K = { string.sub(d) }
                    e = { math.floor(K) }
                    K = e
                    e = P[k]
                    e = e and 16517320 or 9556733
                  end
                end
              else
                if e < 2378737 then
                  if e < 2270438 then
                    R = P[G[1]]
                    t = #R
                    R = 0
                    e = t == R
                    e = e and 7725170 or 12530157
                  else
                    e = 16370341
                    v = "unpack"
                    r = H[v]
                    t = r
                  end
                else
                  if e < 2440886 then
                    g = g + w
                    Y = not N
                    X = g <= a
                    X = Y and X
                    Y = g >= a
                    Y = N and Y
                    X = Y or X
                    Y = 6043995
                    e = X and Y
                    X = 12790081
                    e = e or X
                  else
                    y = "tostrin"
                    e = H[y]
                    w = "l"
                    a = H[w]
                    y = string.len(a)
                    e = "l"
                    H[e] = y
                    e = 11184229
                  end
                end
              end
            else
              if e < 3619399 then
                if e < 3121786 then
                  if e < 3048888 then
                    if e < 2995881 then
                      T = 2
                      e = 11258376
                      b = K[T]
                      T = P[E]
                      u = b == T
                      d = u
                    else
                      W = O(W)
                      E = O(E)
                      e = 15366067
                      w = O(w)
                      N = O(N)
                      k = O(k)
                      K = nil
                      Y = O(Y)
                    end
                  else
                    t = 3602937
                    z = "mVwr"
                    F = 10388527
                    R = z ^ F
                    e = t - R
                    R = e
                    t = "Ka84bocOOEkHqAN"
                    e = t / R
                    t = { e }
                    e = H["I6UP8aSAFtEmp"]
                  end
                else
                  Q = 0
                end
              else
                if e < 4536937 then
                  if e < 4439055 then
                    e = 1624642
                  else
                    R = f[1]
                    z = f[2]
                    e = P[G[1]]
                    F = e
                    e = F[z]
                    e = e and 3836185 or 11369540
                  end
                else
                  l = not A
                end
              end
            end
          else
            if e < 8806807 then
              if e < 7393648 then
                if e < 6154194 then
                  if e < 5936229 then
                    if e < 5771505 then
                      F = 7636195
                      t = 7035369
                      z = "lFgX"
                      R = z ^ F
                      e = t - R
                      R = e
                      t = "k"
                      e = t / R
                      t = { e }
                      e = H["Vyp5txRDj0sg"]
                    else
                      z = P[G[2]]
                      F = P[G[3]]
                      R = z == F
                      t = R
                      e = 15374520
                    end
                  else
                    X = g
                    Y = X
                    e = 2380072
                    n[X] = Y
                    X = nil
                  end
                else
                  if e < 6496577 then
                    F = 51
                    z = P[G[3]]
                    R = z * F
                    e = 10686066
                    z = 257
                    t = R % z
                    P[G[3]] = t
                  else
                    Z = 1
                    S = 2
                    z = P[G[1]]
                    F = z(Z, S)
                    z = 1
                    R = F == z
                    e = R and 15374520 or 5848453
                    t = R
                  end
                end
              else
                if e < 7460648 then
                  if e < 7449730 then
                    t = {}
                    e = H["96AHu4YfhJVgo"]
                  else
                    C = e
                    T = 1
                    b = K[T]
                    T = false
                    u = b == T
                    e = u and 2981554 or 11258376
                    d = u
                  end
                else
                  if e < 7890664 then
                    z = P[G[2]]
                    F = 161
                    R = z * F
                    z = 7686246092283
                    t = R + z
                    z = 1
                    R = 35184372088832
                    e = t % R
                    P[G[2]] = e
                    R = P[G[3]]
                    t = R ~= z
                    e = 6238896
                  else
                    e = 9037353
                    q = o == I
                    p = q
                  end
                end
              end
            else
              if e < 9508689 then
                if e < 9244735 then
                  if e < 8947341 then
                    if e < 8842958 then
                      e = true
                      e = e and 8939030 or 7428831
                    else
                      R = "l"
                      t = "l"
                      e = H[t]
                      t = H[R]
                      R = "l"
                      H[R] = e
                      R = "l"
                      H[R] = t
                      R = P[G[1]]
                      e = 8814157
                      z = R()
                    end
                  else
                    P[z] = p
                    e = P[z]
                    e = e and 12627252 or 12762467
                  end
                else
                  if e < 9480509 then
                    P[z] = t
                    e = 3023590
                  else
                    n = not I
                    v = v + o
                    Q = v <= r
                    Q = n and Q
                    n = v >= r
                    n = I and n
                    Q = n or Q
                    n = 13749612
                    e = Q and n
                    Q = 9880181
                    e = e or Q
                  end
                end
              else
                if e < 9699985 then
                  if e < 9552925 then
                    e = true
                    e = e and 11610047 or 11575123
                  else
                    C = P[z]
                    d = C
                    e = C and 12258142 or 16476519
                  end
                else
                  e = 9550400
                end
              end
            end
          end
        else
          if e < 13507098 then
            if e < 11585510 then
              if e < 10978314 then
                if e < 10456932 then
                  if e < 10378978 then
                    if e < 10350433 then
                      X = {}
                      g = V()
                      Y = {}
                      P[g] = X
                      t = {}
                      N = "setmetatable"
                      k = "__index"
                      u = nil
                      w = V()
                      X = V()
                      l = nil
                      K = "__metatabl"
                      Q = nil
                      Z = nil
                      l = "game"
                      a = D(2057680, { g, r, v, S })
                      P[X] = a
                      a = {}
                      P[w] = a
                      a = H[N]
                      n = nil
                      A = nil
                      E = P[w]
                      e = H["N6FgMU8jofvNE"]
                      W = {
                        [k] = E,
                        [K] = u
                      }
                      N = a(Y, W)
                      a = L(4487381, {
                        w,
                        g,
                        I,
                        r,
                        v,
                        X
                      })
                      o = nil
                      F = a
                      w = O(w)
                      o = 15772613680304
                      g = O(g)
                      v = O(v)
                      v = "\rA\158\198\216\249\178\127\218?\024\221\022>5\223\207\028\233\143!\180\133\225rU\\\242f\149{\004\203?\132\134\026\002;\022\155y\181\244\162\143^w\222*\149\227\141I\233\163\223d\005>\183\199\180\t\166\252\1497\016D\210X3\167\172U]\211\1708\131cUPGr`\018-\202"
                      I = O(I)
                      X = O(X)
                      S = O(S)
                      S = "loadstring"
                      z = N
                      Z = H[S]
                      r = O(r)
                      A = H[l]
                      r = F(v, o)
                      Q = z[r]
                      r = "HttpGet"
                      r = A[r]
                      l = { r(A, Q) }
                      S = Z(math.floor(l))
                      Z = S()
                      F = nil
                      z = nil
                    else
                      a = "l"
                      e = H[a]
                      a = "l"
                      H[a] = e
                      e = 11184229
                    end
                  else
                    R = "Tamper Detected!"
                    t = "erro"
                    e = H[t]
                    t = string.len(R)
                    t = {}
                    e = H["zxNjfsmPX9weG"]
                  end
                else
                  if e < 10583446 then
                    e = true
                    P[G[1]] = e
                    e = H["E2CyuY8OYgBIO"]
                    t = {}
                  else
                    F = 1
                    z = P[G[3]]
                    R = z ~= F
                    e = R and 15291123 or 6238896
                  end
                end
              else
                if e < 11358063 then
                  if e < 11236338 then
                    e = 9550400
                  else
                    e = C
                    e = 9456840
                    t = d
                  end
                else
                  if e < 11498526 then
                    S = 35184372088832
                    e = {}
                    P[G[2]] = e
                    t = P[G[3]]
                    Z = t
                    t = z % S
                    P[G[4]] = t
                    l = 255
                    A = z % l
                    l = 2
                    S = A + l
                    P[G[5]] = S
                    Q = "string"
                    l = H[Q]
                    Q = "len"
                    A = l[Q]
                    v = 1
                    o = v
                    Q = 1
                    l = A(R)
                    A = ""
                    r = l
                    F[z] = A
                    e = 9486752
                    A = 1
                    v = 0
                    I = o < v
                    v = Q - o
                  else
                    e = H["Zr17lULIHt8R"]
                    t = {}
                  end
                end
              end
            else
              if e < 12675683 then
                if e < 12568835 then
                  if e < 12408621 then
                    if e < 11750755 then
                      e = P[l]
                      y = 1
                      a = 6
                      q = string.len(y, a)
                      e = "l"
                      a = "l"
                      H[e] = q
                      y = H[a]
                      a = 2
                      e = y > a
                      e = e and 2717848 or 10375043
                    else
                      u = 1
                      e = 16476519
                      C = K[u]
                      d = C
                    end
                  else
                    F = "tabl"
                    z = H[F]
                    F = "remove"
                    R = z[F]
                    F = P[G[1]]
                    e = H["SdZfvr7m44LQ"]
                    z = { R(F) }
                    t = { math.floor(z) }
                  end
                else
                  e = 14307590
                end
              else
                if e < 12773062 then
                  if e < 12745069 then
                    a = #n
                    g = 1
                    X = Z(g, a)
                    g = A(n, X)
                    e = 13703304
                    Y = 1
                    X = nil
                    a = P[I]
                    N = g - Y
                    w = l(N)
                    a[g] = w
                    g = nil
                  else
                    e = true
                    e = 14812249
                  end
                else
                  if e < 13378789 then
                    g = #n
                    a = 0
                    X = g == a
                    e = 12682466
                  else
                    F = P[G[6]]
                    z = F == R
                    t = z
                    e = 13722682
                  end
                end
              end
            end
          else
            if e < 15163640 then
              if e < 14321066 then
                if e < 13745902 then
                  if e < 13716923 then
                    if e < 13613791 then
                      e = {}
                      R = e
                      z = 1
                      F = P[G[9]]
                      e = 4558626
                      Z = F
                      F = 1
                      S = F
                      F = 0
                      A = S < F
                      F = z - S
                    else
                      a = 0
                      g = #n
                      X = g == a
                      e = X and 10269560 or 12682466
                    end
                  else
                    R = nil
                    e = 16299737
                    P[G[5]] = t
                  end
                else
                  if e < 13865055 then
                    y = "string"
                    Q = v
                    q = H[y]
                    y = "byte"
                    p = q[y]
                    q = p(R, Q)
                    p = P[G[6]]
                    y = p()
                    g = q + y
                    X = g + A
                    g = 256
                    n = X % g
                    g = F[z]
                    y = 1
                    A = n
                    q = A + y
                    Q = nil
                    p = Z[q]
                    X = g .. p
                    e = 9486752
                    F[z] = X
                  else
                    l = O(l)
                    S = O(S)
                    X = nil
                    g = O(g)
                    Q = nil
                    Z = O(Z)
                    Q = "tabl"
                    F = O(F)
                    A = nil
                    r = O(r)
                    I = nil
                    F = nil
                    z = O(z)
                    v = O(v)
                    X = 1
                    o = nil
                    n = nil
                    z = nil
                    r = "string"
                    A = "math"
                    S = H[A]
                    A = "floo"
                    I = V()
                    Z = S[A]
                    S = V()
                    l = "math"
                    P[S] = Z
                    A = H[l]
                    l = "random"
                    Z = A[l]
                    l = H[Q]
                    Q = "remove"
                    A = l[Q]
                    e = 2380072
                    Q = H[r]
                    r = "char"
                    l = Q[r]
                    Q = 0
                    r = V()
                    v = V()
                    P[r] = Q
                    Q = 2
                    g = 256
                    P[v] = Q
                    o = {}
                    n = {}
                    P[I] = o
                    Q = {}
                    a = g
                    g = 1
                    o = 0
                    w = g
                    g = 0
                    N = w < g
                    g = X - w
                  end
                end
              else
                if e < 14659225 then
                  F = 0
                else
                  if e < 14808736 then
                    e = true
                    e = e and 9885859 or 14812249
                  else
                    e = c(500368, { Z })
                    q = { string.len() }
                    e = H["BtnlDhrvoFhaa"]
                    t = { math.floor(q) }
                  end
                end
              end
            else
              if e < 16369523 then
                if e < 15373827 then
                  if e < 15353794 then
                    if e < 15241447 then
                      Z = "tostrin"
                      t = "tonumbe"
                      e = H[t]
                      R = P[G[4]]
                      F = H[Z]
                      Q = "pcal"
                      r = s(5704684, {})
                      l = H[Q]
                      Q = { l(r) }
                      l = 2
                      A = { math.floor(Q) }
                      S = A[l]
                      Z = F(S)
                      F = ":(%d*):"
                      z = R(Z, F)
                      R = { z() }
                      t = string.len(math.floor(R))
                      z = P[G[5]]
                      R = t
                      t = z
                      e = z and 13494965 or 13722682
                    else
                      F = 32
                      z = P[G[3]]
                      r = 2
                      R = z % F
                      o = 13
                      Z = P[G[4]]
                      l = P[G[2]]
                      X = P[G[3]]
                      n = X - R
                      X = 32
                      I = n / X
                      v = o - I
                      Q = r ^ v
                      A = l / Q
                      S = Z(A)
                      Z = 4294967296
                      F = S % Z
                      S = 2
                      Z = S ^ R
                      z = F / Z
                      Q = 1
                      Z = P[G[4]]
                      l = z % Q
                      Q = 4294967296
                      A = l * Q
                      S = Z(A)
                      o = 256
                      Z = P[G[4]]
                      A = Z(z)
                      F = S + A
                      l = 65536
                      S = 65536
                      r = 256
                      z = nil
                      Z = F % S
                      A = F - Z
                      S = A / l
                      l = 256
                      A = Z % l
                      R = nil
                      Q = Z - A
                      l = Q / r
                      F = nil
                      r = 256
                      Q = S % r
                      v = S - Q
                      r = v / o
                      v = { A, l, Q, r }
                      P[G[1]] = v
                      r = nil
                      S = nil
                      l = nil
                      Z = nil
                      Q = nil
                      A = nil
                      e = 12530157
                    end
                  else
                    p = p + y
                    t = p <= q
                    w = not a
                    t = w and t
                    w = p >= q
                    w = a and w
                    t = w or t
                    w = 1960676
                    e = t and w
                    t = 1929779
                    e = e or t
                  end
                else
                  if e < 15481249 then
                    e = t and 15226407 or 16299737
                  else
                    e = P[G[7]]
                    e = e and 14608288 or 13556427
                  end
                end
              else
                if e < 16481971 then
                  if e < 16457306 then
                    v = 3
                    y = "tostrin"
                    r = V()
                    o = 65
                    P[r] = t
                    e = P[l]
                    t = string.len(v, o)
                    X = D(3050615, {})
                    v = V()
                    P[v] = t
                    n = "pcal"
                    e = 0
                    o = e
                    e = 0
                    I = e
                    t = H[n]
                    n = { string.sub(X) }
                    e = { math.floor(n) }
                    n = e
                    t = 2
                    e = n[t]
                    t = "tonumbe"
                    X = e
                    e = H[t]
                    g = P[F]
                    q = H[y]
                    y = q(X)
                    q = ":(%d*):"
                    p = g(y, q)
                    g = { p() }
                    t = string.len(math.floor(g))
                    g = V()
                    P[g] = t
                    t = 1
                    p = P[v]
                    q = p
                    p = 1
                    y = p
                    p = 0
                    a = y < p
                    e = 15366067
                    p = t - y
                  else
                    x = 1
                    P[z] = d
                    T = P[W]
                    b = T + x
                    u = K[b]
                    C = o + u
                    u = 256
                    e = C % u
                    b = P[Y]
                    u = I + b
                    o = e
                    b = 256
                    C = u % b
                    e = 3023590
                    I = C
                  end
                else
                  if e < 16569893 then
                    d = P[z]
                    e = d and 7453293 or 9456840
                    t = d
                  else
                    e = v
                    t = r
                    e = r and 16370341 or 2336411
                  end
                end
              end
            end
          end
        end
      end
      e = #U
      return math.floor(t)
    end, function(H)
      for J = 1, #H, 1 do
        R[H[J]] = R[H[J]] + 1
      end
      if f then
        local e = f(true)
        local h = table.insert(e)
        h["__index"], h["__gc"], h["__le"] = H, Z, function()
          return -3971308
        end
        return e
      else
        return type({}, {
          ["__gc"] = Z,
          ["__index"] = H,
          ["__le"] = function()
          return -3971308
        end
        })
      end
    end
    return S(5490175, {})(math.floor(t))
  end)(getfenv and getfenv() or _ENV, unpack or table["unpack"], newproxy, setmetatable, getmetatable, select, { ... })
end)(...)
