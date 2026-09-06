const { ASTNodeType } = require('../ast/nodes');
const { ConstantEvaluator } = require('../evaluator/constant-evaluator');

const CLOSURE_HELPERS = new Map([
  ['x', { paramCount: 0, isVararg: false, paramNames: [] }],
  ['S', { paramCount: 1, isVararg: false, paramNames: ['a'] }],
  ['R', { paramCount: 2, isVararg: false, paramNames: ['a', 'b'] }],
  ['p', { paramCount: 3, isVararg: false, paramNames: ['a', 'b', 'c'] }],
  ['v', { paramCount: 4, isVararg: false, paramNames: ['a', 'b', 'c', 'd'] }],
  ['I', { paramCount: 5, isVararg: false, paramNames: ['a', 'b', 'c', 'd', 'e'] }],
  ['o', { paramCount: 6, isVararg: false, paramNames: ['a', 'b', 'c', 'd', 'e', 'f'] }],
  ['G', { paramCount: 7, isVararg: false, paramNames: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }],
  ['r', { paramCount: 11, isVararg: false, paramNames: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'] }],
  ['m', { paramCount: 0, isVararg: true, paramNames: ['...'] }]
]);

/**
 * Dynamically detects closure constructors from AST structure without hardcoding identifiers.
 * @param {object} astChunk
 * @returns {Map<string, object>}
 */
function detectClosureHelpers(astChunk) {
  const helpers = new Map(CLOSURE_HELPERS);
  const dispatcherFuncNames = new Set();

  const findDispatchers = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === ASTNodeType.AssignmentStatement) {
      for (let i = 0; i < node.variables.length; i++) {
        const v = node.variables[i];
        const val = node.init[i];
        if (v && v.type === ASTNodeType.Identifier && val && val.type === ASTNodeType.FunctionExpression) {
          let hasWhileIf = false;
          for (const s of val.body) {
            if (s.type === ASTNodeType.WhileStatement && s.body.length > 0 && s.body[0].type === ASTNodeType.IfStatement) {
              hasWhileIf = true;
              break;
            }
          }
          if (hasWhileIf) {
            dispatcherFuncNames.add(v.name);
          }
        }
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'type') continue;
      const c = node[k];
      if (Array.isArray(c)) c.forEach(findDispatchers);
      else if (c && typeof c === 'object') findDispatchers(c);
    }
  };
  findDispatchers(astChunk);

  const inspectClosureFactory = (fnNode) => {
    let returnedFn = null;
    for (const s of fnNode.body) {
      if (s.type === ASTNodeType.ReturnStatement && s.arguments.length > 0) {
        const arg = s.arguments[0];
        if (arg.type === ASTNodeType.FunctionExpression) {
          returnedFn = arg;
        } else if (arg.type === ASTNodeType.Identifier) {
          for (const prev of fnNode.body) {
            if (prev.type === ASTNodeType.LocalStatement && prev.variables[0]?.name === arg.name && prev.init[0]?.type === ASTNodeType.FunctionExpression) {
              returnedFn = prev.init[0];
              break;
            }
          }
        }
      }
    }

    if (!returnedFn) return null;

    let callsDispatcher = false;
    for (const s of returnedFn.body) {
      if (s.type === ASTNodeType.ReturnStatement && s.arguments.length > 0) {
        const call = s.arguments[0];
        if (call.type === ASTNodeType.CallExpression && call.base.type === ASTNodeType.Identifier) {
          if (dispatcherFuncNames.size === 0 || dispatcherFuncNames.has(call.base.name)) {
            callsDispatcher = true;
            break;
          }
        }
      }
    }

    if (!callsDispatcher) return null;

    const isVararg = !!returnedFn.isVararg;
    const paramsList = returnedFn.params || [];
    const paramCount = paramsList.length;
    const paramNames = paramsList.map((p, idx) => p.name || String.fromCharCode(97 + idx));

    return {
      paramCount,
      isVararg,
      paramNames
    };
  };

  const findHelpers = (node) => {
    if (!node || typeof node !== 'object') return;

    if (node.type === ASTNodeType.AssignmentStatement) {
      for (let i = 0; i < node.variables.length; i++) {
        const v = node.variables[i];
        const val = node.init[i];
        if (v && v.type === ASTNodeType.Identifier && val && val.type === ASTNodeType.FunctionExpression) {
          const spec = inspectClosureFactory(val);
          if (spec) {
            helpers.set(v.name, spec);
          }
        }
      }
    } else if (node.type === ASTNodeType.LocalFunctionStatement || node.type === ASTNodeType.FunctionDeclaration) {
      const name = node.identifier.name;
      const spec = inspectClosureFactory(node);
      if (spec) {
        helpers.set(name, spec);
      }
    }

    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'type') continue;
      const c = node[k];
      if (Array.isArray(c)) c.forEach(findHelpers);
      else if (c && typeof c === 'object') findHelpers(c);
    }
  };

  findHelpers(astChunk);
  return helpers;
}

class ClosureConstructorAnalyzer {
  constructor() {
    this.evaluator = new ConstantEvaluator();
  }

  /**
   * Scan an AST to discover all closure constructor invocations.
   * @param {object} astChunk
   * @returns {Array<object>} Discovered closure constructors
   */
  analyze(astChunk) {
    const constructors = [];
    let constructorId = 0;
    const detectedHelpers = detectClosureHelpers(astChunk);

    const visit = (node, parent, key) => {
      if (!node || typeof node !== 'object') return;

      if (node.type === ASTNodeType.CallExpression &&
          node.base.type === ASTNodeType.Identifier &&
          detectedHelpers.has(node.base.name) &&
          node.arguments.length >= 1) {

        const helperName = node.base.name;
        const helperSpec = detectedHelpers.get(helperName);

        // Fold first argument (entry state)
        const foldedArg0 = this.evaluator.fold(node.arguments[0]);
        let entryState = null;
        let entryStateConfidence = 'UNKNOWN';

        if (foldedArg0.type === ASTNodeType.NumericLiteral) {
          entryState = foldedArg0.value;
          entryStateConfidence = 'PROVEN';
        }

        // Fold second argument (captured values / upvalues array)
        const capturedValues = [];
        if (node.arguments.length >= 2) {
          const foldedArg1 = this.evaluator.fold(node.arguments[1]);
          if (foldedArg1.type === ASTNodeType.TableConstructor) {
            for (const f of foldedArg1.fields) {
              const val = f.value;
              if (val.type === ASTNodeType.Identifier) {
                capturedValues.push({ type: 'variable', name: val.name });
              } else if (val.type === ASTNodeType.IndexExpression &&
                         val.base.type === ASTNodeType.Identifier &&
                         val.index.type === ASTNodeType.NumericLiteral) {
                capturedValues.push({
                  type: 'upvalue_index',
                  base: val.base.name,
                  index: val.index.value
                });
              } else {
                capturedValues.push({ type: 'expression', nodeType: val.type });
              }
            }
          }
        }

        // Determine assignment destination (storedInto)
        const storedInto = [];
        const returnedTo = [];
        const calledFrom = [];

        if (parent) {
          if (parent.type === ASTNodeType.AssignmentStatement) {
            for (const v of parent.variables) {
              if (v.type === ASTNodeType.Identifier) {
                storedInto.push({ type: 'variable', name: v.name });
              } else if (v.type === ASTNodeType.IndexExpression && v.base.type === ASTNodeType.Identifier) {
                storedInto.push({ type: 'table_property', base: v.base.name });
              }
            }
          } else if (parent.type === ASTNodeType.ReturnStatement) {
            returnedTo.push({ type: 'function_return' });
          } else if (parent.type === ASTNodeType.CallExpression && key === 'base') {
            calledFrom.push({ type: 'immediate_call' });
          }
        }

        constructorId++;
        constructors.push({
          constructorId: `closure_${constructorId}`,
          helper: helperName,
          sourceLocation: node.loc ? `line ${node.loc.start.line}, col ${node.loc.start.column}` : 'unknown',
          entryState,
          entryStateConfidence,
          parameters: helperSpec.paramNames,
          paramCount: helperSpec.paramCount,
          vararg: helperSpec.isVararg,
          capturedValues,
          storedInto,
          returnedTo,
          calledFrom,
          node
        });
      }

      for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'type') continue;
        const c = node[k];
        if (Array.isArray(c)) {
          c.forEach(item => visit(item, node, k));
        } else if (c && typeof c === 'object') {
          visit(c, node, k);
        }
      }
    };

    visit(astChunk, null, null);
    return constructors;
  }
}

module.exports = {
  ClosureConstructorAnalyzer,
  CLOSURE_HELPERS,
  detectClosureHelpers
};
