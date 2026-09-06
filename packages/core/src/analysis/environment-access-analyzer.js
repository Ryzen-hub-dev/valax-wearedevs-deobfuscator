const { ASTNodeType } = require('../ast/nodes');
const { ConstantEvaluator } = require('../evaluator/constant-evaluator');
const { ByteString } = require('../../../shared/src');

/**
 * Canonical resolution classes for environment accesses (P0-3 & P0-4)
 */
const ResolutionClass = {
  KNOWN_SAFE_BUILTIN: 'KNOWN_SAFE_BUILTIN',
  KNOWN_INTERNAL_BINDING: 'KNOWN_INTERNAL_BINDING',
  UNKNOWN_EXTERNAL_GLOBAL: 'UNKNOWN_EXTERNAL_GLOBAL',
  DYNAMIC_ENVIRONMENT_ACCESS: 'DYNAMIC_ENVIRONMENT_ACCESS',
  UNRESOLVED: 'UNRESOLVED'
};

const SAFE_BUILTIN_NAMES = new Set([
  'assert', 'collectgarbage', 'error', 'getmetatable',
  'ipairs', 'next', 'pairs', 'pcall',
  'print', 'rawequal', 'rawget', 'rawset', 'select', 'setmetatable',
  'tonumber', 'tostring', 'type', 'unpack', 'xpcall', '_VERSION',
  'coroutine', 'table', 'string', 'math', 'os', 'io', 'debug', 'bit', 'bit32', 'warn',
  'newproxy'
]);

const UNSAFE_ENVIRONMENT_BUILTINS = new Set([
  'getfenv', 'setfenv', 'load', 'loadfile', 'loadstring', 'dofile'
]);

const STANDARD_BUILTIN_NAMES = SAFE_BUILTIN_NAMES;

class EnvironmentAccess {
  constructor({
    operation = 'READ',
    environmentBindingId = '_ENV',
    keyKind = 'STATIC_STRING',
    keyValue = null,
    keyProvenance = 'STATIC_AST',
    accessKind = 'GLOBAL_LOOKUP',
    resolvedTarget = null,
    resolutionClass = ResolutionClass.UNRESOLVED,
    proofSource = 'STATIC_AST',
    node = null
  } = {}) {
    this.operation = operation;
    this.environmentBindingId = environmentBindingId;
    this.keyKind = keyKind;
    this.keyValue = keyValue;
    this.keyProvenance = keyProvenance;
    this.accessKind = accessKind;
    this.resolvedTarget = resolvedTarget;
    this.resolutionClass = resolutionClass;
    this.proofSource = proofSource;
    this.node = node;
  }
}

class EnvironmentAccessAnalyzer {
  constructor() {
    this.evaluator = new ConstantEvaluator();
  }

  /**
   * Structurally analyzes environment accesses across AST, IR, string pool, and environment bindings.
   *
   * @param {object} astChunk Lua AST Chunk
   * @param {object} [options]
   * @param {object} [options.adapter] Obfuscator adapter (e.g. WeAreDevsAdapter)
   * @param {object} [options.cfg] Dispatcher CFG
   * @returns {object} Analysis report containing structured EnvironmentAccess records
   */
  analyze(astChunk, options = {}) {
    const adapter = options.adapter || null;
    const cfg = options.cfg || null;

    // Collect dispatcher state variables (P0-3 & P0-4: canonical control flow resolution)
    const dispatcherStateVars = new Set();
    if (options.dispatcherStateVar) {
      dispatcherStateVars.add(options.dispatcherStateVar);
    }
    if (cfg && cfg.stateVar) {
      dispatcherStateVars.add(cfg.stateVar);
    }
    try {
      const { DispatcherAnalyzer } = require('../cfg/dispatcher');
      const da = new DispatcherAnalyzer();
      const disps = da.findDispatchers(astChunk);
      for (const d of disps) {
        if (d && d.stateVar) dispatcherStateVars.add(d.stateVar);
      }
    } catch (_) {}

    // Disallow skipping unreachable blocks during environment access analysis to ensure
    // all external globals and dynamic environment accesses are audited across whole program (P0-3, P0-4, Rule 12).
    const unreachableNodes = new Set();

    // 1. Detect VM Environment binding (e.g. wrapper IIFE passing getfenv/env)
    const vmEnv = this._findVmEnvBinding(astChunk);

    const declaredLocals = new Set();
    const mutatedBuiltins = new Set();
    const mutatedGlobals = new Set();
    let environmentReplaced = false;
    let hasDynamicEnvWrite = false;

    // 2. Collect declared local variables and function parameters
    this._collectLocals(astChunk, declaredLocals);

    // 3. Pre-pass: Detect environment mutations / shadowing (P0-4 Semantic Builtin Resolution)
    this._detectEnvMutations(astChunk, vmEnv, declaredLocals, mutatedBuiltins, mutatedGlobals, {
      onEnvironmentReplaced: () => { environmentReplaced = true; },
      onDynamicEnvWrite: () => { hasDynamicEnvWrite = true; }
    }, false, unreachableNodes, new Set(), new Map(), adapter);

    const accesses = [];

    // 4. Main walk: classify all environment accesses
    const walk = (node, parent = null, inVmScope = false, shadowedVars = new Set(), localConstants = new Map(), enclosingStatements = null) => {
      if (!node || typeof node !== 'object' || unreachableNodes.has(node)) return;
      if (vmEnv && node === vmEnv.bootstrapArg) return;

      const isCurrentVmScope = inVmScope || (vmEnv && node === vmEnv.fnNode);

      // Case A: Free identifier (in un-obfuscated or deobfuscated AST)
      if (node.type === ASTNodeType.Identifier) {
        const isProperty = parent && (
          (parent.type === ASTNodeType.MemberExpression && parent.property === node) ||
          (parent.type === ASTNodeType.TableKey && parent.key === node) ||
          (parent.type === ASTNodeType.TableKeyString && parent.key === node) ||
          (parent.type === ASTNodeType.MethodCallExpression && parent.method === node)
        );
        const isDecl = parent && (
          (parent.type === ASTNodeType.LocalStatement && parent.variables && parent.variables.includes(node)) ||
          (parent.type === ASTNodeType.LocalFunctionStatement && parent.identifier === node) ||
          (parent.type === ASTNodeType.FunctionDeclaration && parent.identifier === node)
        );

        if (!isProperty && !isDecl) {
          const name = node.name;
          if (declaredLocals.has(name) || (shadowedVars && shadowedVars.has(name))) {
            // Local variable: internal binding
            accesses.push(new EnvironmentAccess({
              operation: 'READ',
              environmentBindingId: 'LOCAL_SCOPE',
              keyKind: 'STATIC_STRING',
              keyValue: name,
              keyProvenance: 'AST_LOCAL_DECLARATION',
              accessKind: 'LOCAL_LOOKUP',
              resolvedTarget: name,
              resolutionClass: ResolutionClass.KNOWN_INTERNAL_BINDING,
              proofSource: 'STATIC_AST',
              node
            }));
          } else {
            // Free global identifier
            const isCall = parent && parent.type === ASTNodeType.CallExpression && parent.base === node;
            const op = isCall ? 'CALL' : 'READ';
            const accessKind = isCall ? 'GLOBAL_CALL' : 'GLOBAL_LOOKUP';

            if (name === 'setfenv') {
              environmentReplaced = true;
              accesses.push(new EnvironmentAccess({
                operation: op,
                environmentBindingId: '_ENV',
                keyKind: 'STATIC_STRING',
                keyValue: name,
                keyProvenance: 'AST_FREE_IDENTIFIER',
                accessKind,
                resolvedTarget: name,
                resolutionClass: ResolutionClass.DYNAMIC_ENVIRONMENT_ACCESS,
                proofSource: 'STATIC_AST',
                node
              }));
            } else if (name === 'getfenv' || name === 'load' || name === 'loadstring' || name === 'loadfile' || name === 'dofile') {
              accesses.push(new EnvironmentAccess({
                operation: op,
                environmentBindingId: '_ENV',
                keyKind: 'STATIC_STRING',
                keyValue: name,
                keyProvenance: 'AST_FREE_IDENTIFIER',
                accessKind,
                resolvedTarget: name,
                resolutionClass: ResolutionClass.DYNAMIC_ENVIRONMENT_ACCESS,
                proofSource: 'STATIC_AST',
                node
              }));
            } else if (SAFE_BUILTIN_NAMES.has(name)) {
              if (environmentReplaced || hasDynamicEnvWrite || mutatedBuiltins.has(name)) {
                accesses.push(new EnvironmentAccess({
                  operation: op,
                  environmentBindingId: '_ENV',
                  keyKind: 'STATIC_STRING',
                  keyValue: name,
                  keyProvenance: 'AST_FREE_IDENTIFIER',
                  accessKind,
                  resolvedTarget: name,
                  resolutionClass: ResolutionClass.UNKNOWN_EXTERNAL_GLOBAL,
                  proofSource: 'STATIC_AST',
                  node
                }));
              } else {
                accesses.push(new EnvironmentAccess({
                  operation: op,
                  environmentBindingId: '_ENV',
                  keyKind: 'STATIC_STRING',
                  keyValue: name,
                  keyProvenance: 'AST_FREE_IDENTIFIER',
                  accessKind,
                  resolvedTarget: name,
                  resolutionClass: ResolutionClass.KNOWN_SAFE_BUILTIN,
                  proofSource: 'STATIC_AST',
                  node
                }));
              }
            } else if (mutatedGlobals.has(name)) {
              accesses.push(new EnvironmentAccess({
                operation: op,
                environmentBindingId: '_ENV',
                keyKind: 'STATIC_STRING',
                keyValue: name,
                keyProvenance: 'AST_MUTATED_GLOBAL',
                accessKind: 'INTERNAL_REGISTER_LOOKUP',
                resolvedTarget: name,
                resolutionClass: ResolutionClass.KNOWN_INTERNAL_BINDING,
                proofSource: 'STATIC_DEF_USE',
                node
              }));
            } else if (
              parent &&
              parent.type === ASTNodeType.AssignmentStatement &&
              parent.variables &&
              parent.variables.some((v, idx) => v.type === ASTNodeType.Identifier && dispatcherStateVars.has(v.name) && parent.init && parent.init[idx] === node)
            ) {
              accesses.push(new EnvironmentAccess({
                operation: op,
                environmentBindingId: '_ENV',
                keyKind: 'STATIC_STRING',
                keyValue: name,
                keyProvenance: 'AST_DISPATCHER_EXIT',
                accessKind: 'DISPATCHER_EXIT_LOOKUP',
                resolvedTarget: name,
                resolutionClass: ResolutionClass.KNOWN_INTERNAL_BINDING,
                proofSource: 'STATIC_CONTROL_FLOW',
                node
              }));
            } else {
              // Free non-builtin global variable
              accesses.push(new EnvironmentAccess({
                operation: op,
                environmentBindingId: '_ENV',
                keyKind: 'STATIC_STRING',
                keyValue: name,
                keyProvenance: 'AST_FREE_IDENTIFIER',
                accessKind,
                resolvedTarget: name,
                resolutionClass: ResolutionClass.UNKNOWN_EXTERNAL_GLOBAL,
                proofSource: 'STATIC_AST',
                node
              }));
            }
          }
        }
      }

      // Case B: Explicit indexing into environment table
      else if (node.type === ASTNodeType.IndexExpression && node.base) {
        const envBinding = this._isEnvTable(node.base, isCurrentVmScope, vmEnv, shadowedVars);
        if (envBinding) {
          const keyResolution = this._resolveKey(node.index, adapter, localConstants);
          if (keyResolution.kind === 'NUMERIC_INDEX') {
            // Numeric index is array indexing, NOT an environment access
          } else {
            const isCall = parent && parent.type === ASTNodeType.CallExpression && parent.base === node;
            const op = isCall ? 'CALL' : 'READ';
            const accessKind = isCall ? 'GLOBAL_CALL' : 'GLOBAL_LOOKUP';

            if (keyResolution.kind === 'STATIC_STRING') {
              const keyStr = keyResolution.value;
              if (keyStr === 'setfenv') {
                environmentReplaced = true;
                accesses.push(new EnvironmentAccess({
                  operation: op,
                  environmentBindingId: envBinding,
                  keyKind: 'STATIC_STRING',
                  keyValue: keyStr,
                  keyProvenance: keyResolution.provenance,
                  accessKind,
                  resolvedTarget: keyStr,
                  resolutionClass: ResolutionClass.DYNAMIC_ENVIRONMENT_ACCESS,
                  proofSource: 'STATIC_AST_AND_IR',
                  node
                }));
              } else if (keyStr === 'getfenv' || keyStr === 'load' || keyStr === 'loadstring' || keyStr === 'loadfile' || keyStr === 'dofile') {
                accesses.push(new EnvironmentAccess({
                  operation: op,
                  environmentBindingId: envBinding,
                  keyKind: 'STATIC_STRING',
                  keyValue: keyStr,
                  keyProvenance: keyResolution.provenance,
                  accessKind,
                  resolvedTarget: keyStr,
                  resolutionClass: ResolutionClass.DYNAMIC_ENVIRONMENT_ACCESS,
                  proofSource: 'STATIC_AST_AND_IR',
                  node
                }));
              } else if (SAFE_BUILTIN_NAMES.has(keyStr)) {
                if (environmentReplaced || hasDynamicEnvWrite || mutatedBuiltins.has(keyStr)) {
                  accesses.push(new EnvironmentAccess({
                    operation: op,
                    environmentBindingId: envBinding,
                    keyKind: 'STATIC_STRING',
                    keyValue: keyStr,
                    keyProvenance: keyResolution.provenance,
                    accessKind,
                    resolvedTarget: keyStr,
                    resolutionClass: ResolutionClass.UNKNOWN_EXTERNAL_GLOBAL,
                    proofSource: 'STATIC_AST_AND_IR',
                    node
                  }));
                } else {
                  accesses.push(new EnvironmentAccess({
                    operation: op,
                    environmentBindingId: envBinding,
                    keyKind: 'STATIC_STRING',
                    keyValue: keyStr,
                    keyProvenance: keyResolution.provenance,
                    accessKind,
                    resolvedTarget: keyStr,
                    resolutionClass: ResolutionClass.KNOWN_SAFE_BUILTIN,
                    proofSource: 'STATIC_AST_AND_IR',
                    node
                  }));
                }
              } else if (mutatedGlobals.has(keyStr)) {
                // Key was explicitly written/mutated by the script itself (e.g. internal registers k["l1"], k["l2"])
                accesses.push(new EnvironmentAccess({
                  operation: op,
                  environmentBindingId: envBinding,
                  keyKind: 'STATIC_STRING',
                  keyValue: keyStr,
                  keyProvenance: keyResolution.provenance,
                  accessKind: 'INTERNAL_REGISTER_LOOKUP',
                  resolvedTarget: keyStr,
                  resolutionClass: ResolutionClass.KNOWN_INTERNAL_BINDING,
                  proofSource: 'STATIC_DEF_USE',
                  node
                }));
              } else if (
                parent &&
                parent.type === ASTNodeType.AssignmentStatement &&
                parent.variables &&
                parent.variables.some((v, idx) => v.type === ASTNodeType.Identifier && dispatcherStateVars.has(v.name) && parent.init && parent.init[idx] === node)
              ) {
                // Dispatcher loop exit transition (e.g. stateVar = env["dummyKey"] to evaluate to nil and break while stateVar do)
                accesses.push(new EnvironmentAccess({
                  operation: op,
                  environmentBindingId: envBinding,
                  keyKind: 'STATIC_STRING',
                  keyValue: keyStr,
                  keyProvenance: keyResolution.provenance,
                  accessKind: 'DISPATCHER_EXIT_LOOKUP',
                  resolvedTarget: keyStr,
                  resolutionClass: ResolutionClass.KNOWN_INTERNAL_BINDING,
                  proofSource: 'STATIC_CONTROL_FLOW',
                  node
                }));
              } else if (this._isInternalNonEscapingAccess(node, parent, enclosingStatements)) {
                // Internal non-escaping scratch register access (e.g. y["l1"] passed strictly to pure builtin string.len)
                accesses.push(new EnvironmentAccess({
                  operation: op,
                  environmentBindingId: envBinding,
                  keyKind: 'STATIC_STRING',
                  keyValue: keyStr,
                  keyProvenance: keyResolution.provenance,
                  accessKind: 'INTERNAL_SCRATCH_LOOKUP',
                  resolvedTarget: keyStr,
                  resolutionClass: ResolutionClass.KNOWN_INTERNAL_BINDING,
                  proofSource: 'STATIC_DEF_USE',
                  node
                }));
              } else {
                // Static non-builtin key looked up on environment table
                accesses.push(new EnvironmentAccess({
                  operation: op,
                  environmentBindingId: envBinding,
                  keyKind: 'STATIC_STRING',
                  keyValue: keyStr,
                  keyProvenance: keyResolution.provenance,
                  accessKind,
                  resolvedTarget: keyStr,
                  resolutionClass: ResolutionClass.UNKNOWN_EXTERNAL_GLOBAL,
                  proofSource: 'STATIC_AST_AND_IR',
                  node
                }));
              }
            } else {
              // Dynamic key expression
              accesses.push(new EnvironmentAccess({
                operation: op,
                environmentBindingId: envBinding,
                keyKind: 'DYNAMIC_EXPR',
                keyValue: null,
                keyProvenance: keyResolution.provenance,
                accessKind: 'DYNAMIC_INDEX',
                resolvedTarget: null,
                resolutionClass: ResolutionClass.DYNAMIC_ENVIRONMENT_ACCESS,
                proofSource: 'STATIC_AST_AND_IR',
                node
              }));
            }
          }
        }
      }

      // Case C: MemberExpression on environment table (e.g. _ENV.foo, _G.print, env.bar)
      else if (node.type === ASTNodeType.MemberExpression && node.base && node.property) {
        const envBinding = this._isEnvTable(node.base, isCurrentVmScope, vmEnv, shadowedVars);
        if (envBinding && node.property.type === ASTNodeType.Identifier) {
          const keyStr = node.property.name;
          const isCall = parent && parent.type === ASTNodeType.CallExpression && parent.base === node;
          const op = isCall ? 'CALL' : 'READ';
          const accessKind = isCall ? 'GLOBAL_CALL' : 'GLOBAL_LOOKUP';

          if (keyStr === 'setfenv') {
            environmentReplaced = true;
            accesses.push(new EnvironmentAccess({
              operation: op,
              environmentBindingId: envBinding,
              keyKind: 'STATIC_STRING',
              keyValue: keyStr,
              keyProvenance: 'MEMBER_IDENTIFIER',
              accessKind,
              resolvedTarget: keyStr,
              resolutionClass: ResolutionClass.DYNAMIC_ENVIRONMENT_ACCESS,
              proofSource: 'STATIC_AST',
              node
            }));
          } else if (keyStr === 'getfenv' || keyStr === 'load' || keyStr === 'loadstring' || keyStr === 'loadfile' || keyStr === 'dofile') {
            accesses.push(new EnvironmentAccess({
              operation: op,
              environmentBindingId: envBinding,
              keyKind: 'STATIC_STRING',
              keyValue: keyStr,
              keyProvenance: 'MEMBER_IDENTIFIER',
              accessKind,
              resolvedTarget: keyStr,
              resolutionClass: ResolutionClass.DYNAMIC_ENVIRONMENT_ACCESS,
              proofSource: 'STATIC_AST',
              node
            }));
          } else if (SAFE_BUILTIN_NAMES.has(keyStr)) {
            if (environmentReplaced || hasDynamicEnvWrite || mutatedBuiltins.has(keyStr)) {
              accesses.push(new EnvironmentAccess({
                operation: op,
                environmentBindingId: envBinding,
                keyKind: 'STATIC_STRING',
                keyValue: keyStr,
                keyProvenance: 'MEMBER_IDENTIFIER',
                accessKind,
                resolvedTarget: keyStr,
                resolutionClass: ResolutionClass.UNKNOWN_EXTERNAL_GLOBAL,
                proofSource: 'STATIC_AST',
                node
              }));
            } else {
              accesses.push(new EnvironmentAccess({
                operation: op,
                environmentBindingId: envBinding,
                keyKind: 'STATIC_STRING',
                keyValue: keyStr,
                keyProvenance: 'MEMBER_IDENTIFIER',
                accessKind,
                resolvedTarget: keyStr,
                resolutionClass: ResolutionClass.KNOWN_SAFE_BUILTIN,
                proofSource: 'STATIC_AST',
                node
              }));
            }
          } else if (mutatedGlobals.has(keyStr)) {
            accesses.push(new EnvironmentAccess({
              operation: op,
              environmentBindingId: envBinding,
              keyKind: 'STATIC_STRING',
              keyValue: keyStr,
              keyProvenance: 'MEMBER_IDENTIFIER',
              accessKind: 'INTERNAL_REGISTER_LOOKUP',
              resolvedTarget: keyStr,
              resolutionClass: ResolutionClass.KNOWN_INTERNAL_BINDING,
              proofSource: 'STATIC_DEF_USE',
              node
            }));
          } else if (
            parent &&
            parent.type === ASTNodeType.AssignmentStatement &&
            parent.variables &&
            parent.variables.some((v, idx) => v.type === ASTNodeType.Identifier && dispatcherStateVars.has(v.name) && parent.init && parent.init[idx] === node)
          ) {
            accesses.push(new EnvironmentAccess({
              operation: op,
              environmentBindingId: envBinding,
              keyKind: 'STATIC_STRING',
              keyValue: keyStr,
              keyProvenance: 'MEMBER_IDENTIFIER',
              accessKind: 'DISPATCHER_EXIT_LOOKUP',
              resolvedTarget: keyStr,
              resolutionClass: ResolutionClass.KNOWN_INTERNAL_BINDING,
              proofSource: 'STATIC_CONTROL_FLOW',
              node
            }));
          } else if (this._isInternalNonEscapingAccess(node, parent, enclosingStatements)) {
            accesses.push(new EnvironmentAccess({
              operation: op,
              environmentBindingId: envBinding,
              keyKind: 'STATIC_STRING',
              keyValue: keyStr,
              keyProvenance: 'MEMBER_IDENTIFIER',
              accessKind: 'INTERNAL_SCRATCH_LOOKUP',
              resolvedTarget: keyStr,
              resolutionClass: ResolutionClass.KNOWN_INTERNAL_BINDING,
              proofSource: 'STATIC_DEF_USE',
              node
            }));
          } else {
            accesses.push(new EnvironmentAccess({
              operation: op,
              environmentBindingId: envBinding,
              keyKind: 'STATIC_STRING',
              keyValue: keyStr,
              keyProvenance: 'MEMBER_IDENTIFIER',
              accessKind,
              resolvedTarget: keyStr,
              resolutionClass: ResolutionClass.UNKNOWN_EXTERNAL_GLOBAL,
              proofSource: 'STATIC_AST',
              node
            }));
          }
        }
      }

      const computeChildShadowed = (childNode, baseShadowed) => {
        if (!childNode || typeof childNode !== 'object') return baseShadowed;
        if (childNode === vmEnv?.fnNode) {
          const next = new Set(baseShadowed);
          if (vmEnv.paramName) next.delete(vmEnv.paramName);
          return next;
        }
        if (childNode.type === ASTNodeType.FunctionExpression || childNode.type === ASTNodeType.FunctionDeclaration) {
          const next = new Set(baseShadowed);
          for (const p of childNode.params || []) {
            if (p && p.name) next.add(p.name);
          }
          return next;
        } else if (childNode.type === ASTNodeType.LocalFunctionStatement) {
          const next = new Set(baseShadowed);
          for (const p of childNode.params || []) {
            if (p && p.name) next.add(p.name);
          }
          return next;
        } else if (childNode.type === ASTNodeType.NumericForStatement) {
          const next = new Set(baseShadowed);
          if (childNode.variable && childNode.variable.name) next.add(childNode.variable.name);
          return next;
        } else if (childNode.type === ASTNodeType.GenericForStatement) {
          const next = new Set(baseShadowed);
          for (const v of childNode.variables || []) {
            if (v && v.name) next.add(v.name);
          }
          return next;
        }
        return baseShadowed;
      };

      for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'type') continue;
        const child = node[k];
        if (Array.isArray(child)) {
          let blockShadowed = shadowedVars;
          let blockConstants = new Map(localConstants);
          const isStmtList = child.length > 0 && child.some(item => item && typeof item === 'object' && item.type && (item.type.endsWith('Statement') || item.type.endsWith('Declaration')));
          const nextEnclosing = isStmtList ? child : enclosingStatements;
          for (const c of child) {
            if (c && typeof c === 'object') {
              if (c.type === ASTNodeType.LocalStatement) {
                blockShadowed = new Set(blockShadowed);
                for (const v of c.variables || []) {
                  if (v && v.name) {
                    blockShadowed.add(v.name);
                    blockConstants.delete(v.name);
                  }
                }
              } else if (c.type === ASTNodeType.LocalFunctionStatement) {
                blockShadowed = new Set(blockShadowed);
                if (c.identifier && c.identifier.name) {
                  blockShadowed.add(c.identifier.name);
                  blockConstants.delete(c.identifier.name);
                }
              } else if (c.type === ASTNodeType.AssignmentStatement) {
                for (let i = 0; i < (c.variables || []).length; i++) {
                  const target = c.variables[i];
                  const init = c.init?.[i];
                  if (target && target.type === ASTNodeType.Identifier) {
                    let strVal = null;
                    if (init) {
                      const keyRes = this._resolveKey(init, adapter, blockConstants);
                      if (keyRes && keyRes.kind === 'STATIC_STRING') {
                        strVal = keyRes.value;
                      } else if (init.type === ASTNodeType.StringLiteral) {
                        strVal = init.value instanceof ByteString ? init.value.toString('latin1') : String(init.value);
                      } else if (init.type === ASTNodeType.IndexExpression && init.base) {
                        const envBinding = this._isEnvTable(init.base, isCurrentVmScope, vmEnv, blockShadowed);
                        if (envBinding) {
                          const subKey = this._resolveKey(init.index, adapter, blockConstants);
                          if (subKey.kind === 'STATIC_STRING') {
                            strVal = subKey.value;
                          }
                        }
                      } else {
                        try {
                          const folded = this.evaluator.fold(init);
                          if (folded && folded.type === ASTNodeType.StringLiteral) {
                            strVal = folded.value instanceof ByteString ? folded.value.toString('latin1') : String(folded.value);
                          }
                        } catch (_) {}
                      }
                    }
                    if (strVal !== null) {
                      blockConstants.set(target.name, strVal);
                    } else {
                      blockConstants.delete(target.name);
                    }
                  }
                }
              }
              const childShadowed = computeChildShadowed(c, blockShadowed);
              walk(c, node, isCurrentVmScope, childShadowed, blockConstants, nextEnclosing);
            }
          }
        } else if (child && typeof child === 'object') {
          const childShadowed = computeChildShadowed(child, shadowedVars);
          walk(child, node, isCurrentVmScope, childShadowed, localConstants, enclosingStatements);
        }
      }
    };

    walk(astChunk);

    // Group accesses
    const safeBuiltins = accesses.filter(a => a.resolutionClass === ResolutionClass.KNOWN_SAFE_BUILTIN);
    const internalBindings = accesses.filter(a => a.resolutionClass === ResolutionClass.KNOWN_INTERNAL_BINDING);
    const unknownGlobals = accesses.filter(a => a.resolutionClass === ResolutionClass.UNKNOWN_EXTERNAL_GLOBAL);
    const dynamicAccesses = accesses.filter(a => a.resolutionClass === ResolutionClass.DYNAMIC_ENVIRONMENT_ACCESS);
    const unresolved = accesses.filter(a => a.resolutionClass === ResolutionClass.UNRESOLVED);

    const isClosed = unknownGlobals.length === 0 &&
                     dynamicAccesses.length === 0 &&
                     unresolved.length === 0 &&
                     !environmentReplaced &&
                     !hasDynamicEnvWrite;

    return {
      accesses,
      safeBuiltins,
      internalBindings,
      unknownGlobals,
      dynamicAccesses,
      unresolved,
      mutatedBuiltins: Array.from(mutatedBuiltins),
      mutatedGlobals: Array.from(mutatedGlobals),
      environmentReplaced,
      hasDynamicEnvWrite,
      isClosed,
      proofSource: 'STATIC_AST_AND_IR'
    };
  }

  _findVmEnvBinding(astChunk) {
    let vmEnvBinding = null;
    const findCall = (node) => {
      if (!node || typeof node !== 'object' || vmEnvBinding) return;
      if (node.type === ASTNodeType.CallExpression && node.arguments && node.arguments.length > 0) {
        const arg0 = node.arguments[0];
        const isEnvExpr = (expr) => {
          if (!expr || typeof expr !== 'object') return false;
          if (expr.type === ASTNodeType.Identifier && (expr.name === '_ENV' || expr.name === '_G')) return true;
          if (expr.type === ASTNodeType.CallExpression && expr.base && (expr.base.name === 'getfenv' || expr.base.name === '_ENV')) return true;
          if (expr.type === ASTNodeType.LogicalExpression) {
            return isEnvExpr(expr.left) || isEnvExpr(expr.right);
          }
          return false;
        };
        const isEnvArg = isEnvExpr(arg0);
        if (isEnvArg && node.base && node.base.type === ASTNodeType.FunctionExpression) {
          if (node.base.params && node.base.params.length > 0) {
            vmEnvBinding = {
              fnNode: node.base,
              paramName: node.base.params[0].name,
              bootstrapArg: arg0
            };
            return;
          }
        }
      }
      for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'type') continue;
        const c = node[k];
        if (Array.isArray(c)) c.forEach(findCall);
        else if (c && typeof c === 'object') findCall(c);
      }
    };
    findCall(astChunk);
    return vmEnvBinding;
  }

  _isEnvTable(baseNode, inVmScope, vmEnv, shadowedVars = null) {
    if (!baseNode) return null;
    if (baseNode.type === ASTNodeType.Identifier) {
      if (shadowedVars && shadowedVars.has(baseNode.name)) {
        return null;
      }
      if (baseNode.name === '_ENV' || baseNode.name === '_G') {
        return baseNode.name;
      }
      if (inVmScope && vmEnv && baseNode.name === vmEnv.paramName) {
        return vmEnv.paramName;
      }
    }
    if (baseNode.type === ASTNodeType.CallExpression && baseNode.base && baseNode.base.name === 'getfenv') {
      return 'getfenv()';
    }
    return null;
  }

  _collectLocals(node, declaredLocals) {
    if (!node || typeof node !== 'object') return;
    if (node.type === ASTNodeType.LocalStatement) {
      for (const v of node.variables || []) {
        if (v && v.name) declaredLocals.add(v.name);
      }
    } else if (node.type === ASTNodeType.LocalFunctionStatement) {
      if (node.identifier && node.identifier.name) declaredLocals.add(node.identifier.name);
      for (const p of node.params || []) {
        if (p && p.name) declaredLocals.add(p.name);
      }
    } else if (node.type === ASTNodeType.NumericForStatement) {
      if (node.variable && node.variable.name) declaredLocals.add(node.variable.name);
    } else if (node.type === ASTNodeType.GenericForStatement) {
      for (const v of node.variables || []) {
        if (v && v.name) declaredLocals.add(v.name);
      }
    } else if (node.type === ASTNodeType.FunctionDeclaration || node.type === ASTNodeType.FunctionExpression) {
      for (const p of node.params || []) {
        if (p && p.name) declaredLocals.add(p.name);
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'type') continue;
      const c = node[k];
      if (Array.isArray(c)) c.forEach(item => this._collectLocals(item, declaredLocals));
      else if (c && typeof c === 'object') this._collectLocals(c, declaredLocals);
    }
  }

  _detectEnvMutations(node, vmEnv, declaredLocals, mutatedBuiltins, mutatedGlobals, callbacks, inVmScope = false, unreachableNodes = null, shadowedVars = new Set(), localConstants = new Map(), adapter = null) {
    if (!node || typeof node !== 'object' || (unreachableNodes && unreachableNodes.has(node))) return;
    if (vmEnv && node === vmEnv.bootstrapArg) return;

    const isCurrentVmScope = inVmScope || (vmEnv && node === vmEnv.fnNode);

    // Check setfenv call
    if (node.type === ASTNodeType.CallExpression) {
      if (node.base) {
        const isSetfenvIdent = node.base.type === ASTNodeType.Identifier &&
          (node.base.name === 'setfenv' || localConstants.get(node.base.name) === 'setfenv');
        const isSetfenvIndex = node.base.type === ASTNodeType.IndexExpression &&
          this._isEnvTable(node.base.base, isCurrentVmScope, vmEnv, shadowedVars) &&
          this._resolveKey(node.base.index, adapter, localConstants).value === 'setfenv';
        if (isSetfenvIdent || isSetfenvIndex) {
          callbacks.onEnvironmentReplaced();
        }
      }
    }

    // Check assignments
    if (node.type === ASTNodeType.AssignmentStatement) {
      for (const target of node.variables || []) {
        // Free global variable assignment: print = externalFunction
        if (target.type === ASTNodeType.Identifier && !declaredLocals.has(target.name) && !shadowedVars.has(target.name)) {
          if (STANDARD_BUILTIN_NAMES.has(target.name)) {
            mutatedBuiltins.add(target.name);
          } else {
            mutatedGlobals.add(target.name);
          }
        }
        // Member write on environment table: _ENV.print = externalFunction
        else if (target.type === ASTNodeType.MemberExpression && target.base && target.property) {
          const envBinding = this._isEnvTable(target.base, isCurrentVmScope, vmEnv, shadowedVars);
          if (envBinding && target.property.type === ASTNodeType.Identifier) {
            const propName = target.property.name;
            if (STANDARD_BUILTIN_NAMES.has(propName)) {
              mutatedBuiltins.add(propName);
            } else {
              mutatedGlobals.add(propName);
            }
          }
        }
        // Index write on environment table: R["print"] = externalFunction or _G[dynamicKey] = ...
        else if (target.type === ASTNodeType.IndexExpression && target.base) {
          const envBinding = this._isEnvTable(target.base, isCurrentVmScope, vmEnv, shadowedVars);
          if (envBinding) {
            const keyRes = this._resolveKey(target.index, adapter, localConstants);
            if (keyRes.kind === 'NUMERIC_INDEX') {
              // Numeric array index assignment, not an environment mutation
            } else if (keyRes.kind === 'STATIC_STRING') {
              if (STANDARD_BUILTIN_NAMES.has(keyRes.value)) {
                mutatedBuiltins.add(keyRes.value);
              } else {
                mutatedGlobals.add(keyRes.value);
              }
            } else {
              callbacks.onDynamicEnvWrite(node, target);
            }
          }
        }
      }
    }

    const computeChildShadowed = (childNode, baseShadowed) => {
      if (!childNode || typeof childNode !== 'object') return baseShadowed;
      if (childNode === vmEnv?.fnNode) {
        const next = new Set(baseShadowed);
        if (vmEnv.paramName) next.delete(vmEnv.paramName);
        return next;
      }
      if (childNode.type === ASTNodeType.FunctionExpression || childNode.type === ASTNodeType.FunctionDeclaration) {
        const next = new Set(baseShadowed);
        for (const p of childNode.params || []) {
          if (p && p.name) next.add(p.name);
        }
        return next;
      } else if (childNode.type === ASTNodeType.LocalFunctionStatement) {
        const next = new Set(baseShadowed);
        for (const p of childNode.params || []) {
          if (p && p.name) next.add(p.name);
        }
        return next;
      } else if (childNode.type === ASTNodeType.NumericForStatement) {
        const next = new Set(baseShadowed);
        if (childNode.variable && childNode.variable.name) next.add(childNode.variable.name);
        return next;
      } else if (childNode.type === ASTNodeType.GenericForStatement) {
        const next = new Set(baseShadowed);
        for (const v of childNode.variables || []) {
          if (v && v.name) next.add(v.name);
        }
        return next;
      }
      return baseShadowed;
    };

    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'type') continue;
      const child = node[k];
      if (Array.isArray(child)) {
        let blockShadowed = shadowedVars;
        let blockConstants = new Map(localConstants);
        for (const c of child) {
          if (c && typeof c === 'object') {
            if (c.type === ASTNodeType.LocalStatement) {
              blockShadowed = new Set(blockShadowed);
              for (const v of c.variables || []) {
                if (v && v.name) {
                  blockShadowed.add(v.name);
                  blockConstants.delete(v.name);
                }
              }
            } else if (c.type === ASTNodeType.LocalFunctionStatement) {
              blockShadowed = new Set(blockShadowed);
              if (c.identifier && c.identifier.name) {
                blockShadowed.add(c.identifier.name);
                blockConstants.delete(c.identifier.name);
              }
            } else if (c.type === ASTNodeType.AssignmentStatement) {
              for (let i = 0; i < (c.variables || []).length; i++) {
                const target = c.variables[i];
                const init = c.init?.[i];
                if (target && target.type === ASTNodeType.Identifier) {
                  let strVal = null;
                  if (init) {
                    const keyRes = this._resolveKey(init, adapter, blockConstants);
                    if (keyRes && keyRes.kind === 'STATIC_STRING') {
                      strVal = keyRes.value;
                    } else if (init.type === ASTNodeType.StringLiteral) {
                      strVal = init.value instanceof ByteString ? init.value.toString('latin1') : String(init.value);
                    } else if (init.type === ASTNodeType.IndexExpression && init.base) {
                      const envBinding = this._isEnvTable(init.base, isCurrentVmScope, vmEnv, blockShadowed);
                      if (envBinding) {
                        const subKey = this._resolveKey(init.index, adapter, blockConstants);
                        if (subKey.kind === 'STATIC_STRING') {
                          strVal = subKey.value;
                        }
                      }
                    } else {
                      try {
                        const folded = this.evaluator.fold(init);
                        if (folded && folded.type === ASTNodeType.StringLiteral) {
                          strVal = folded.value instanceof ByteString ? folded.value.toString('latin1') : String(folded.value);
                        }
                      } catch (_) {}
                    }
                  }
                  if (strVal !== null) {
                    blockConstants.set(target.name, strVal);
                  } else {
                    blockConstants.delete(target.name);
                  }
                }
              }
            }
            const childShadowed = computeChildShadowed(c, blockShadowed);
            this._detectEnvMutations(c, vmEnv, declaredLocals, mutatedBuiltins, mutatedGlobals, callbacks, isCurrentVmScope, unreachableNodes, childShadowed, blockConstants, adapter);
          }
        }
      } else if (child && typeof child === 'object') {
        const childShadowed = computeChildShadowed(child, shadowedVars);
        this._detectEnvMutations(child, vmEnv, declaredLocals, mutatedBuiltins, mutatedGlobals, callbacks, isCurrentVmScope, unreachableNodes, childShadowed, localConstants, adapter);
      }
    }
  }

  _containsNode(parent, target) {
    if (!parent || !target || typeof parent !== 'object') return false;
    if (parent === target) return true;
    for (const k of Object.keys(parent)) {
      if (k === 'loc' || k === 'type') continue;
      const c = parent[k];
      if (Array.isArray(c)) {
        for (const item of c) {
          if (this._containsNode(item, target)) return true;
        }
      } else if (c && typeof c === 'object') {
        if (this._containsNode(c, target)) return true;
      }
    }
    return false;
  }

  _isInternalNonEscapingAccess(indexNode, parentStmt, blockStatements) {
    if (!blockStatements || !Array.isArray(blockStatements)) return false;

    let stmt = null;
    let stmtIdx = -1;
    for (let i = 0; i < blockStatements.length; i++) {
      const s = blockStatements[i];
      if (s === parentStmt || s === indexNode || this._containsNode(s, indexNode)) {
        stmt = s;
        stmtIdx = i;
        break;
      }
    }
    if (!stmt || stmtIdx === -1) return false;

    if (stmt.type !== ASTNodeType.AssignmentStatement && stmt.type !== ASTNodeType.LocalStatement) return false;
    const vars = stmt.variables || [];
    if (vars.length === 0) return false;

    let varIndex = -1;
    if (stmt.init) {
      for (let j = 0; j < stmt.init.length; j++) {
        if (stmt.init[j] === indexNode || this._containsNode(stmt.init[j], indexNode)) {
          varIndex = j;
          break;
        }
      }
    }
    const targetVar = varIndex >= 0 && varIndex < vars.length ? vars[varIndex] : (vars.length === 1 ? vars[0] : null);
    if (!targetVar || targetVar.type !== ASTNodeType.Identifier) return false;
    const varName = targetVar.name;

    let usedInPureBuiltin = false;
    let escapes = false;

    const checkExpr = (n, inPureBuiltinArg = false) => {
      if (!n || typeof n !== 'object' || escapes) return;
      if (n.type === ASTNodeType.Identifier && n.name === varName) {
        if (!inPureBuiltinArg) {
          escapes = true;
        } else {
          usedInPureBuiltin = true;
        }
        return;
      }
      if (n.type === ASTNodeType.CallExpression) {
        const isPureBuiltin = n.base && n.base.type === ASTNodeType.Identifier &&
          (n.base.name === 'string' || n.base.name === 'type' || n.base.name === 'tonumber' || n.base.name === 'tostring');
        const isStringLen = n.base && n.base.type === ASTNodeType.MemberExpression &&
          n.base.base?.name === 'string' && n.base.property?.name === 'len';

        const isPure = isPureBuiltin || isStringLen;
        if (n.base && n.base.type === ASTNodeType.Identifier && n.base.name === varName) {
          escapes = true;
        }
        for (const arg of n.arguments || []) {
          checkExpr(arg, isPure);
        }
        return;
      }
      if (n.type === ASTNodeType.ReturnStatement) {
        escapes = true;
        return;
      }
      for (const k of Object.keys(n)) {
        if (k === 'loc' || k === 'type') continue;
        const c = n[k];
        if (Array.isArray(c)) c.forEach(x => checkExpr(x, inPureBuiltinArg));
        else if (c && typeof c === 'object') checkExpr(c, inPureBuiltinArg);
      }
    };

    for (let i = stmtIdx + 1; i < blockStatements.length; i++) {
      const s = blockStatements[i];
      if (s.type === ASTNodeType.AssignmentStatement && s.variables?.some(v => v.name === varName)) {
        break;
      }
      checkExpr(s, false);
    }

    return !escapes && usedInPureBuiltin;
  }

  _resolveKey(indexNode, adapter, localConstants = null) {
    if (!indexNode) return { kind: 'UNRESOLVED', value: null, provenance: 'NULL_INDEX' };

    // 0. Numeric indexing: R[1], s[2], etc. (Array indexing, not global variable lookup)
    if (indexNode.type === ASTNodeType.NumericLiteral) {
      return { kind: 'NUMERIC_INDEX', value: indexNode.value, provenance: 'AST_NUMERIC_LITERAL' };
    }
    try {
      const foldedNum = this.evaluator.fold(indexNode);
      if (foldedNum && foldedNum.type === ASTNodeType.NumericLiteral) {
        return { kind: 'NUMERIC_INDEX', value: foldedNum.value, provenance: 'CONSTANT_FOLDED_NUMBER' };
      }
    } catch (_) {}

    // 1. Literal string: R["print"]
    if (indexNode.type === ASTNodeType.StringLiteral) {
      let val = indexNode.value;
      if (val instanceof ByteString) val = val.toString('latin1');
      return { kind: 'STATIC_STRING', value: String(val), provenance: 'AST_STRING_LITERAL' };
    }

    // 2. Foldable constant
    try {
      const folded = this.evaluator.fold(indexNode);
      if (folded && folded.type === ASTNodeType.StringLiteral) {
        let val = folded.value;
        if (val instanceof ByteString) val = val.toString('latin1');
        return { kind: 'STATIC_STRING', value: String(val), provenance: 'CONSTANT_FOLDED_STRING' };
      }
    } catch (_) {}

    // 2b. Intra-block local constant binding: v = "print"; g[v]
    if (localConstants && indexNode.type === ASTNodeType.Identifier && localConstants.has(indexNode.name)) {
      return { kind: 'STATIC_STRING', value: localConstants.get(indexNode.name), provenance: `LOCAL_BINDING[${indexNode.name}]` };
    }

    // 3. Adapter string pool accessor: R[J(offset)]
    if (adapter && adapter.accessorName && adapter.stringTable && indexNode.type === ASTNodeType.CallExpression) {
      if (indexNode.base && indexNode.base.name === adapter.accessorName && indexNode.arguments.length === 1) {
        try {
          const argFolded = this.evaluator.fold(indexNode.arguments[0]);
          if (argFolded && argFolded.type === ASTNodeType.NumericLiteral) {
            const rawIdx = argFolded.value + (adapter.accessorOffset || 0);
            const entryIdx = rawIdx - 1; // 1-based Lua indexing
            if (entryIdx >= 0 && entryIdx < adapter.stringTable.length) {
              let s = adapter.stringTable[entryIdx];
              if (s instanceof ByteString) s = s.toString('latin1');
              if (typeof s === 'string') {
                return { kind: 'STATIC_STRING', value: s, provenance: `DECODED_STRING_POOL[${entryIdx}]` };
              }
            }
          }
        } catch (_) {}
      }
    }

    return { kind: 'DYNAMIC_EXPR', value: null, provenance: 'DYNAMIC_AST_EXPRESSION' };
  }
}

module.exports = {
  EnvironmentAccessAnalyzer,
  EnvironmentAccess,
  ResolutionClass,
  STANDARD_BUILTIN_NAMES
};
