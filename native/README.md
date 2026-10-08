# Valax Native Engine

`valax-native` is the C++20 execution front-end for heavyweight Lua/Luau recovery jobs.

The first native milestone provides an O(n), constant-extra-memory source preflight scanner. It measures token volume, nesting depth, line shape, and input size before the JavaScript recovery pipeline allocates an AST. The worker uses the result to select a safe recovery tier and prevent an operating-system OOM kill.

Build and test:

```sh
cmake -S native -B native/build -DCMAKE_BUILD_TYPE=Release
cmake --build native/build --config Release
ctest --test-dir native/build --output-on-failure
```

Protocol:

```sh
valax-native preflight < protected.lua
```

The command emits one JSON object. It never receives secrets and never executes the submitted program.

Planned native milestones are a compact token buffer, Lua/Luau parser, arena-backed AST, constant folding, string-pool recovery, and dispatcher CFG reconstruction. The stable JSON worker boundary allows these components to replace their JavaScript equivalents incrementally.
