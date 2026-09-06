const { ASTNodeType, stringLiteral } = require('../../ast/nodes');
const { ConstantEvaluator } = require('../../evaluator/constant-evaluator');
const { ByteString } = require('../../../../shared/src');

class WeAreDevsAdapter {
  constructor() {
    this.alphabet = null; // Map of char -> 0..63
    this.stringTable = []; // Decoded ByteString entries
    this.accessorName = null;
    this.accessorOffset = null;
    this.rotationRanges = [];
    this.stats = {
      stringsFound: 0,
      stringsRecovered: 0,
      rotationRangesApplied: 0
    };
  }

  /**
   * Check if AST matches WeAreDevs obfuscator.
   * Looks for header comment or characteristic structure:
   * local A = {...}, for W, Q in ipairs({...}), local function W(W), local K = {...}
   * @param {object} astChunk
   * @param {string} [rawSource]
   */
  detect(astChunk, rawSource = '') {
    if (rawSource.includes('wearedevs.net/obfuscator')) {
      return { detected: true, version: 'v1.0.0', confidence: 1.0 };
    }

    // Structural heuristic:
    // First statement is return function(...) or local A = { large array }
    if (astChunk.body && astChunk.body.length > 0) {
      const firstStmt = astChunk.body[0];
      if (firstStmt.type === ASTNodeType.ReturnStatement && firstStmt.arguments.length > 0) {
        const arg = firstStmt.arguments[0];
        if (arg.type === ASTNodeType.CallExpression &&
            arg.base.type === ASTNodeType.FunctionExpression) {
          const innerBody = arg.base.body;
          if (innerBody.length > 0 &&
              innerBody[0].type === ASTNodeType.LocalStatement &&
              innerBody[0].init[0] &&
              innerBody[0].init[0].type === ASTNodeType.TableConstructor &&
              innerBody[0].init[0].fields.length > 100) {
            return { detected: true, version: 'v1.0.0', confidence: 0.95 };
          }
        }
      }
    }

    return { detected: false, version: 'unknown', confidence: 0.0 };
  }

  /**
   * Extract and decode the string pool from the WeAreDevs AST.
   * @param {object} astChunk
   */
  extractAndDecode(astChunk) {
    const evaluator = new ConstantEvaluator();

    // Find the inner body containing the setup
    let setupBody = astChunk.body;
    if (astChunk.body.length === 1 &&
        astChunk.body[0].type === ASTNodeType.ReturnStatement &&
        astChunk.body[0].arguments[0] &&
        astChunk.body[0].arguments[0].type === ASTNodeType.CallExpression &&
        astChunk.body[0].arguments[0].base.type === ASTNodeType.FunctionExpression) {
      setupBody = astChunk.body[0].arguments[0].base.body;
    }

    // 1. Find string table declaration: local A = { ... }
    let rawTableNode = null;
    let tableVarName = 'A';
    for (const stmt of setupBody) {
      if (stmt.type === ASTNodeType.LocalStatement &&
          stmt.init.length > 0 &&
          stmt.init[0].type === ASTNodeType.TableConstructor &&
          stmt.init[0].fields.length >= 20) {
        rawTableNode = stmt.init[0];
        tableVarName = stmt.variables[0].name;
        break;
      }
    }

    if (!rawTableNode) {
      return false;
    }

    // Extract raw string entries
    const entries = [];
    for (const field of rawTableNode.fields) {
      const val = field.type === ASTNodeType.TableValue ? field.value : field.value;
      if (val.type === ASTNodeType.StringLiteral) {
        entries.push(val.value); // ByteString
      } else {
        entries.push(new ByteString(''));
      }
    }
    this.stats.stringsFound = entries.length;

    // 2. Find rotation/shuffle loop: for W, Q in ipairs({ {s1, e1}, {s2, e2}, ... })
    for (const stmt of setupBody) {
      if (stmt.type === ASTNodeType.GenericForStatement &&
          stmt.iterators.length > 0 &&
          stmt.iterators[0].type === ASTNodeType.CallExpression &&
          stmt.iterators[0].arguments.length > 0 &&
          stmt.iterators[0].arguments[0].type === ASTNodeType.TableConstructor) {
        const rangesTable = stmt.iterators[0].arguments[0];
        for (const field of rangesTable.fields) {
          const pairNode = field.value;
          if (pairNode && pairNode.type === ASTNodeType.TableConstructor && pairNode.fields.length >= 2) {
            const startNode = evaluator.fold(pairNode.fields[0].value);
            const endNode = evaluator.fold(pairNode.fields[1].value);
            if (startNode.type === ASTNodeType.NumericLiteral && endNode.type === ASTNodeType.NumericLiteral) {
              this.rotationRanges.push([startNode.value, endNode.value]);
            }
          }
        }
        break;
      }
    }

    // Apply 2-pointer array reversals (1-based Lua indices)
    for (const [start, end] of this.rotationRanges) {
      let l = start - 1;
      let r = end - 1;
      while (l < r && l >= 0 && r < entries.length) {
        const tmp = entries[l];
        entries[l] = entries[r];
        entries[r] = tmp;
        l++;
        r--;
      }
      this.stats.rotationRangesApplied++;
    }

    // 3. Find accessor function: local function W(W) return A[W +/- offset] end
    for (const stmt of setupBody) {
      if (stmt.type === ASTNodeType.LocalFunctionStatement && stmt.body.length === 1) {
        const ret = stmt.body[0];
        if (ret.type === ASTNodeType.ReturnStatement &&
            ret.arguments.length === 1 &&
            ret.arguments[0].type === ASTNodeType.IndexExpression) {
          const indexExpr = evaluator.fold(ret.arguments[0].index);
          if (indexExpr.type === ASTNodeType.BinaryExpression &&
              (indexExpr.operator === '+' || indexExpr.operator === '-')) {
            if (indexExpr.right.type === ASTNodeType.NumericLiteral) {
              this.accessorName = stmt.identifier.name;
              this.accessorOffset = indexExpr.operator === '+' ? indexExpr.right.value : -indexExpr.right.value;
              break;
            }
          }
        }
      }
    }

    // 4. Find alphabet table: local K = { R = 31, X = 58, ... } (dynamically match >= 60 fields)
    for (const stmt of setupBody) {
      let candidateTable = null;
      if (stmt.type === ASTNodeType.DoStatement) {
        for (const s of stmt.body) {
          if (s.type === ASTNodeType.LocalStatement &&
              s.init[0] && s.init[0].type === ASTNodeType.TableConstructor &&
              s.init[0].fields.length >= 60) {
            candidateTable = s.init[0];
            break;
          }
        }
      }
      if (candidateTable) {
        const alphabetMap = new Map();
        for (const field of candidateTable.fields) {
          let keyChar = null;
          if (field.type === ASTNodeType.TableKeyString) {
            keyChar = field.key.name;
          } else if (field.type === ASTNodeType.TableKey && field.key.type === ASTNodeType.StringLiteral) {
            keyChar = field.key.value.toString('latin1');
          }
          if (keyChar) {
            const foldedVal = evaluator.fold(field.value);
            if (foldedVal.type === ASTNodeType.NumericLiteral) {
              alphabetMap.set(keyChar, foldedVal.value);
            }
          }
        }
        this.alphabet = alphabetMap;
        break;
      }
    }

    // Fallback standard base64 if not detected
    if (!this.alphabet || this.alphabet.size < 60) {
      const stdAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      this.alphabet = new Map();
      for (let i = 0; i < stdAlphabet.length; i++) {
        this.alphabet.set(stdAlphabet[i], i);
      }
    }

    // 5. Decode all entries using the alphabet map
    const decodedTable = [];
    for (let i = 0; i < entries.length; i++) {
      const rawBs = entries[i];
      const rawStr = rawBs.toString('latin1');
      const decodedBytes = this.decodeBase64Custom(rawStr, this.alphabet);
      decodedTable.push(new ByteString(decodedBytes));
    }

    this.stringTable = decodedTable;
    this.stats.stringsRecovered = decodedTable.length;
    return true;
  }

  /**
   * Decode custom base64 string according to the alphabet table.
   * @param {string} str
   * @param {Map<string, number>} alphabet
   */
  decodeBase64Custom(str, alphabet) {
    const bytes = [];
    let f = 0;
    let U = 0;

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (alphabet.has(ch)) {
        const val = alphabet.get(ch);
        f = f + val * Math.pow(64, 3 - U);
        U++;
        if (U === 4) {
          U = 0;
          bytes.push(Math.floor(f / 65536) & 0xff);
          bytes.push(Math.floor((f % 65536) / 256) & 0xff);
          bytes.push(f % 256);
          f = 0;
        }
      } else if (ch === '=') {
        bytes.push(Math.floor(f / 65536) & 0xff);
        if (i + 1 >= str.length || str[i + 1] !== '=') {
          bytes.push(Math.floor((f % 65536) / 256) & 0xff);
        }
        break;
      }
    }

    return bytes;
  }

  /**
   * Resolve a string table lookup: W(offset) or A[index]
   * @param {number} argOffset
   * @returns {ByteString | null}
   */
  resolveLookup(argOffset) {
    const index = argOffset + this.accessorOffset; // 1-based index
    const idx0 = index - 1;
    if (idx0 >= 0 && idx0 < this.stringTable.length) {
      return this.stringTable[idx0];
    }
    return null;
  }
}

module.exports = { WeAreDevsAdapter };
