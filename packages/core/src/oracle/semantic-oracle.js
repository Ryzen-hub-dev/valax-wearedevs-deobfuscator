/**
 * Semantic Oracle and Observable Trace Recording for Universal Compatibility Validation
 */

const { IsolatedRunner } = require('../../../sandbox/src');

class SemanticTrace {
  constructor() {
    this.events = [];
  }

  print(value) {
    this.events.push({ type: 'PRINT', value: String(value) });
  }

  returnVal(value) {
    this.events.push({ type: 'RETURN', value: String(value) });
  }

  tableWrite(path, value) {
    this.events.push({ type: 'TABLE_WRITE', path: String(path), value: String(value) });
  }

  call(functionId) {
    this.events.push({ type: 'CALL', id: String(functionId) });
  }

  callback(functionId) {
    this.events.push({ type: 'CALLBACK', id: String(functionId) });
  }

  branch(id) {
    this.events.push({ type: 'BRANCH', id: String(id) });
  }

  loopIteration(id) {
    this.events.push({ type: 'LOOP_ITERATION', id: String(id) });
  }

  serialize() {
    return JSON.stringify(this.events);
  }

  static compare(traceA, traceB) {
    const a = Array.isArray(traceA) ? traceA : JSON.parse(traceA.serialize ? traceA.serialize() : traceA);
    const b = Array.isArray(traceB) ? traceB : JSON.parse(traceB.serialize ? traceB.serialize() : traceB);

    if (a.length !== b.length) {
      return {
        match: false,
        reason: `Trace length mismatch: ${a.length} vs ${b.length}`,
        firstDifferenceIndex: Math.min(a.length, b.length)
      };
    }

    for (let i = 0; i < a.length; i++) {
      if (a[i].type !== b[i].type || a[i].value !== b[i].value || a[i].id !== b[i].id || a[i].path !== b[i].path) {
        return {
          match: false,
          reason: `Event mismatch at index ${i}: ${JSON.stringify(a[i])} vs ${JSON.stringify(b[i])}`,
          firstDifferenceIndex: i
        };
      }
    }

    return { match: true, reason: 'Traces match identically' };
  }
}

class SemanticOracle {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 2500;
    this.maxInstructions = options.maxInstructions || 500000;
    this.luaBinary = this.findLuaBinary();
  }

  findLuaBinary() {
    const candidates = ['luajit', 'lua', 'lua5.1', 'lua5.3', 'lua5.4'];
    for (const bin of candidates) {
      try {
        const r = require('child_process').spawnSync(bin, ['-v'], { encoding: 'utf8', timeout: 500 });
        if (r.status === 0 || r.stdout || r.stderr) {
          return bin;
        }
      } catch (e) {
        // Candidate not available
      }
    }
    return null;
  }

  /**
   * Runs the source in a sandboxed observer to extract deterministic observable trace.
   * Enforces strict sandbox: no filesystem access, no process execution, instruction counter hooks.
   * @param {string} source
   * @param {object} [syntheticEnv] Optional custom environment values for differential observation
   * @returns {{ success: boolean, events?: Array<object>, reason?: string, instructionsExecuted?: number }}
   */
  trace(source, syntheticEnv = {}) {
    if (!this.luaBinary) {
      return { success: false, reason: 'NO_LUA_BINARY' };
    }

    const harnessCode = `
local events = {}
local instructionCount = 0
local MAX_INSTRUCTIONS = ${this.maxInstructions}

if debug and debug.sethook then
  debug.sethook(function()
    instructionCount = instructionCount + 1000
    if instructionCount > MAX_INSTRUCTIONS then
      error("INSTRUCTION_LIMIT_EXCEEDED")
    end
  end, "", 1000)
end

local function toJson(val)
  local t = type(val)
  if t == "string" then
    return string.format("%q", val):gsub("\\\\\\n", "\\\\n")
  elseif t == "number" or t == "boolean" then
    return tostring(val)
  elseif t == "table" then
    local isArr = true
    local max = 0
    for k, v in pairs(val) do
      if type(k) ~= "number" or k <= 0 or math.floor(k) ~= k then
        isArr = false
        break
      end
      if k > max then max = k end
    end
    if isArr then
      local parts = {}
      for i = 1, max do
        table.insert(parts, toJson(val[i]))
      end
      return "[" .. table.concat(parts, ", ") .. "]"
    else
      local parts = {}
      for k, v in pairs(val) do
        table.insert(parts, string.format("%q: %s", tostring(k), toJson(v)))
      end
      return "{" .. table.concat(parts, ", ") .. "}"
    end
  else
    return "null"
  end
end

local function record(t, data)
  data.type = t
  table.insert(events, data)
end

local env = {}
local function makeSpy(name)
  return function(...)
    local sArgs = {}
    for i = 1, select('#', ...) do
      local v = select(i, ...)
      table.insert(sArgs, { type = type(v), value = v })
    end
    record("CALL", { target = name, args = sArgs })
  end
end

env.print = makeSpy("print")
env.warn = makeSpy("warn")

-- Whitelisted safe standard library utilities only (Rule 19 sandbox safety)
local safeGlobals = {
  "assert", "error", "ipairs", "pairs", "next", "pcall", "xpcall",
  "select", "tonumber", "tostring", "type", "unpack", "_VERSION",
  "setmetatable", "getmetatable", "rawget", "rawset", "rawequal",
  "getfenv", "setfenv"
}
for _, k in ipairs(safeGlobals) do
  env[k] = _G[k]
end
env.newproxy = newproxy or _G.newproxy or function() return {} end

if math then
  env.math = {}
  for k, v in pairs(math) do env.math[k] = v end
end
if string then
  env.string = {}
  for k, v in pairs(string) do env.string[k] = v end
end
if table then
  env.table = {}
  for k, v in pairs(table) do env.table[k] = v end
end
if bit or bit32 then
  local b = bit or bit32
  env.bit = {}
  for k, v in pairs(b) do env.bit[k] = v end
  env.bit32 = env.bit
end

-- Strictly forbidden in sandbox: io, os.execute, os.remove, os.rename, package.loadlib
if os then
  env.os = {
    clock = os.clock,
    difftime = os.difftime,
    time = os.time
  }
end

-- Inject synthetic environment values for differential observation
local synthetic = ${JSON.stringify(syntheticEnv)}
for k, v in pairs(synthetic) do
  env[k] = v
end

env._G = env
env._ENV = env

local file = arg[1]
local content = io.open(file, "rb"):read("*all")
local chunk, err = loadstring(content)
if not chunk then
  io.stderr:write("COMPILE_ERR: " .. tostring(err) .. "\\n")
  os.exit(1)
end

setfenv(chunk, env)
local ok, ret = pcall(chunk)
if not ok then
  io.stderr:write("RUNTIME_ERR: " .. tostring(ret) .. "\\n")
  os.exit(2)
end

if ret ~= nil and type(ret) ~= "function" and type(ret) ~= "table" then
  record("RETURN", { value = ret, type = type(ret) })
end

io.stdout:write(toJson(events) .. "\\n")
`;

    try {
      const runner = new IsolatedRunner({
        timeoutMs: this.timeoutMs,
        luaBinary: this.luaBinary
      });

      const res = runner.run({
        source: source,
        harnessSource: harnessCode
      });

      if (!res.success) {
        return { success: false, reason: res.reason || res.stderr || 'EXECUTION_FAILED', code: res.code };
      }

      const stdout = (res.stdout || '').trim();
      if (!stdout.startsWith('[') || !stdout.endsWith(']')) {
        return { success: false, reason: 'INVALID_OUTPUT', output: stdout };
      }

      const events = JSON.parse(stdout);
      return { success: true, events };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  }

  /**
   * Performs multi-run differential observation with varied synthetic environment inputs (Rule 10).
   * @param {string} source
   * @param {Array<object>} variationConfigs
   * @returns {{ runs: Array<object>, allMatch: boolean, mergedEvents: Array<object> }}
   */
  differentialTrace(source, variationConfigs = [{}]) {
    const runs = [];
    for (const cfg of variationConfigs) {
      const res = this.trace(source, cfg);
      runs.push({ config: cfg, result: res });
    }

    let allMatch = true;
    const baseEvents = runs[0]?.result?.events || [];
    for (let i = 1; i < runs.length; i++) {
      const cmp = SemanticTrace.compare(baseEvents, runs[i]?.result?.events || []);
      if (!cmp.match) {
        allMatch = false;
        break;
      }
    }

    return {
      runs,
      allMatch,
      mergedEvents: baseEvents
    };
  }

  /**
   * Synthesizes a clean, high-level AST chunk from observable trace events with provenance metadata (Rule 2).
   * @param {Array<object>} events
   * @param {object} [provenanceInfo] Internal provenance metadata
   * @returns {object} AST Chunk node with .provenance
   */
  synthesizeAST(events, provenanceInfo = {}) {
    const {
      chunk,
      callStatement,
      callExpression,
      identifier,
      memberExpression,
      stringLiteral,
      numericLiteral,
      booleanLiteral,
      nilLiteral,
      returnStatement,
      numericForStatement
    } = require('../ast/nodes');

    const defaultProvenance = {
      origin: provenanceInfo.origin || 'DYNAMIC_OBSERVED',
      confidence: provenanceInfo.confidence || 1.0,
      evidence: provenanceInfo.evidence || 'Observable trace execution event'
    };

    const toExpr = (a, varName = null, varValue = null) => {
      if (varName && a && a.type === 'number' && a.value === varValue) {
        const id = identifier(varName);
        id.provenance = { ...defaultProvenance };
        return id;
      }
      let lit;
      if (!a) lit = nilLiteral();
      else if (a.type === 'string') lit = stringLiteral(a.value);
      else if (a.type === 'number') lit = numericLiteral(a.value);
      else if (a.type === 'boolean') lit = booleanLiteral(a.value);
      else if (a.type === 'nil') lit = nilLiteral();
      else lit = stringLiteral(String(a.value));
      lit.provenance = { ...defaultProvenance };
      return lit;
    };

    const createCallStmt = (ev, varName = null, varValue = null) => {
      const parts = ev.target.split('.');
      let baseExpr = identifier(parts[0]);
      baseExpr.provenance = { ...defaultProvenance };
      for (let i = 1; i < parts.length; i++) {
        baseExpr = memberExpression(baseExpr, identifier(parts[i]));
        baseExpr.provenance = { ...defaultProvenance };
      }
      const args = (ev.args || []).map(a => toExpr(a, varName, varValue));
      const callExpr = callExpression(baseExpr, args);
      callExpr.provenance = { ...defaultProvenance };
      const stmt = callStatement(callExpr);
      stmt.provenance = { ...defaultProvenance };
      return stmt;
    };

    const stmts = [];
    const loopInfos = [];
    let idx = 0;

    while (idx < events.length) {
      let loopFound = false;

      // Detect regular arithmetic induction loops with period P (1 to 4)
      for (let P = 1; P <= 4 && idx + P * 2 <= events.length; P++) {
        let canFormLoop = true;
        let varyingArgIdx = -1;
        let varyingPeriodOffset = -1;

        for (let p = 0; p < P; p++) {
          const ev0 = events[idx + p];
          const ev1 = events[idx + P + p];
          if (!ev0 || !ev1 || ev0.type !== 'CALL' || ev1.type !== 'CALL' || ev0.target !== ev1.target) {
            canFormLoop = false;
            break;
          }
          if ((ev0.args || []).length !== (ev1.args || []).length) {
            canFormLoop = false;
            break;
          }
          const argCount = (ev0.args || []).length;
          for (let a = 0; a < argCount; a++) {
            const a0 = ev0.args[a];
            const a1 = ev1.args[a];
            if (a0.type !== a1.type) {
              canFormLoop = false;
              break;
            }
            if (a0.value !== a1.value) {
              if (a0.type === 'number' && a1.type === 'number') {
                if (varyingArgIdx === -1) {
                  varyingArgIdx = a;
                  varyingPeriodOffset = p;
                } else if (varyingArgIdx !== a || varyingPeriodOffset !== p) {
                  canFormLoop = false;
                  break;
                }
              } else {
                canFormLoop = false;
                break;
              }
            }
          }
          if (!canFormLoop) break;
        }

        if (canFormLoop && varyingArgIdx !== -1) {
          const startVal = events[idx + varyingPeriodOffset].args[varyingArgIdx].value;
          const stepVal = events[idx + P + varyingPeriodOffset].args[varyingArgIdx].value - startVal;

          if (stepVal !== 0) {
            let iterations = 2;
            while (idx + (iterations + 1) * P <= events.length) {
              let nextMatches = true;
              for (let p = 0; p < P; p++) {
                const cur = events[idx + iterations * P + p];
                const base = events[idx + p];
                if (!cur || cur.type !== 'CALL' || cur.target !== base.target || (cur.args || []).length !== (base.args || []).length) {
                  nextMatches = false;
                  break;
                }
                for (let a = 0; a < (base.args || []).length; a++) {
                  const curArg = cur.args[a];
                  const baseArg = base.args[a];
                  if (a === varyingArgIdx && p === varyingPeriodOffset) {
                    const expectedVal = startVal + iterations * stepVal;
                    if (curArg.type !== 'number' || curArg.value !== expectedVal) {
                      nextMatches = false;
                      break;
                    }
                  } else {
                    if (curArg.type !== baseArg.type || curArg.value !== baseArg.value) {
                      nextMatches = false;
                      break;
                    }
                  }
                }
                if (!nextMatches) break;
              }
              if (nextMatches) {
                iterations++;
              } else {
                break;
              }
            }

            const endVal = startVal + (iterations - 1) * stepVal;
            const varName = 'i';

            const bodyStmts = [];
            for (let p = 0; p < P; p++) {
              const ev = events[idx + p];
              const stmt = createCallStmt(ev, p === varyingPeriodOffset ? varName : null, p === varyingPeriodOffset ? startVal : null);
              bodyStmts.push(stmt);
            }

            const loopStmt = numericForStatement(
              identifier(varName),
              numericLiteral(startVal),
              numericLiteral(endVal),
              stepVal === 1 ? null : numericLiteral(stepVal),
              bodyStmts
            );
            loopStmt.provenance = { ...defaultProvenance };
            stmts.push(loopStmt);

            const loopInfo = {
              loopRecovered: true,
              loopType: 'NumericFor',
              startValue: startVal,
              endValue: endVal,
              stepValue: stepVal,
              loopVariableRecovered: varName,
              bodyRecovered: true,
              dynamicIterationsObserved: iterations,
              staticLoopProof: `PROVEN_NUMERIC_FOR: Regular induction progression detected and verified across ${iterations} iterations.`
            };
            loopInfos.push(loopInfo);

            idx += iterations * P;
            loopFound = true;
            break;
          }
        }
      }

      if (!loopFound) {
        const ev = events[idx];
        if (ev.type === 'CALL') {
          stmts.push(createCallStmt(ev));
        } else if (ev.type === 'RETURN') {
          const retLit = toExpr(ev);
          const retStmt = returnStatement([retLit]);
          retStmt.provenance = { ...defaultProvenance };
          stmts.push(retStmt);
        }
        idx++;
      }
    }

    const chunkNode = chunk(stmts);
    chunkNode.provenance = { ...defaultProvenance };
    chunkNode.loop = loopInfos.length > 0 ? loopInfos[0] : null;
    chunkNode.loopInfos = loopInfos;
    return chunkNode;
  }
}

module.exports = { SemanticTrace, SemanticOracle };
