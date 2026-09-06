const fs = require('fs');
const path = require('path');
const { parse } = require('../packages/core/src/parser');
const { ASTNodeType } = require('../packages/core/src/ast/nodes');
const { ConstantEvaluator } = require('../packages/core/src/evaluator/constant-evaluator');
const { ByteString } = require('../packages/shared/src/bytestring');

function auditStrings(fixturePath) {
  const source = fs.readFileSync(fixturePath, 'utf8');
  const ast = parse(source);
  const evaluator = new ConstantEvaluator();

  let setupBody = ast.body;
  if (ast.body.length === 1 &&
      ast.body[0].type === ASTNodeType.ReturnStatement &&
      ast.body[0].arguments[0] &&
      ast.body[0].arguments[0].type === ASTNodeType.CallExpression &&
      ast.body[0].arguments[0].base.type === ASTNodeType.FunctionExpression) {
    setupBody = ast.body[0].arguments[0].base.body;
  }

  // 1. Raw string table
  let rawTableNode = null;
  for (const stmt of setupBody) {
    if (stmt.type === ASTNodeType.LocalStatement &&
        stmt.init.length > 0 &&
        stmt.init[0].type === ASTNodeType.TableConstructor &&
        stmt.init[0].fields.length > 50) {
      rawTableNode = stmt.init[0];
      break;
    }
  }

  const entries = [];
  for (const field of rawTableNode.fields) {
    if (field.value.type === ASTNodeType.StringLiteral) {
      entries.push(field.value.value); // ByteString
    } else {
      entries.push(new ByteString(''));
    }
  }

  // 2. Rotation ranges
  const rotationRanges = [];
  for (const stmt of setupBody) {
    if (stmt.type === ASTNodeType.GenericForStatement &&
        stmt.iterators[0] && stmt.iterators[0].arguments[0]) {
      const tbl = stmt.iterators[0].arguments[0];
      for (const f of tbl.fields) {
        const pair = f.value;
        if (pair && pair.type === ASTNodeType.TableConstructor && pair.fields.length >= 2) {
          const s = evaluator.fold(pair.fields[0].value).value;
          const e = evaluator.fold(pair.fields[1].value).value;
          rotationRanges.push([s, e]);
        }
      }
      break;
    }
  }

  // Apply rotation
  for (const [s, e] of rotationRanges) {
    let l = s - 1, r = e - 1;
    while (l < r && l >= 0 && r < entries.length) {
      const tmp = entries[l];
      entries[l] = entries[r];
      entries[r] = tmp;
      l++; r--;
    }
  }

  // 3. Alphabet table
  let alphabet = new Map();
  for (const stmt of setupBody) {
    if (stmt.type === ASTNodeType.DoStatement) {
      for (const s of stmt.body) {
        if (s.type === ASTNodeType.LocalStatement &&
            s.variables[0].name === 'K' &&
            s.init[0]) {
          for (const f of s.init[0].fields) {
            let ch = null;
            if (f.type === ASTNodeType.TableKeyString) ch = f.key.name;
            else if (f.type === ASTNodeType.TableKey && f.key.type === ASTNodeType.StringLiteral) {
              ch = f.key.value.toString('latin1');
            }
            if (ch) {
              const val = evaluator.fold(f.value).value;
              alphabet.set(ch, val);
            }
          }
        }
      }
    }
  }

  // 4. Audit each string decoding
  let successfullyDecoded = 0;
  let ambiguousEntries = 0;
  let binaryEntries = 0;
  let invalidEntries = 0;
  const decodedSample = [];

  for (let i = 0; i < entries.length; i++) {
    const rawStr = entries[i].toString('latin1');
    let hasInvalidChars = false;
    let paddingStarted = false;
    let invalidPadding = false;

    // Verify character set & padding
    for (let c = 0; c < rawStr.length; c++) {
      const ch = rawStr[c];
      if (ch === '=') {
        paddingStarted = true;
      } else if (paddingStarted) {
        // Character after padding = is invalid base64
        invalidPadding = true;
      } else if (!alphabet.has(ch)) {
        hasInvalidChars = true;
      }
    }

    if (hasInvalidChars || invalidPadding) {
      invalidEntries++;
      continue;
    }

    // Decode bytes
    const bytes = [];
    let f = 0;
    let U = 0;
    for (let c = 0; c < rawStr.length; c++) {
      const ch = rawStr[c];
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
        if (c + 1 < rawStr.length && rawStr[c + 1] !== '=') {
          bytes.push(Math.floor((f % 65536) / 256) & 0xff);
        }
        break;
      }
    }

    // Inspect decoded bytes
    let hasZero = false;
    let hasHighByte = false;
    for (const b of bytes) {
      if (b === 0) hasZero = true;
      if (b > 127) hasHighByte = true;
    }

    if (hasZero || hasHighByte) {
      binaryEntries++;
    }

    successfullyDecoded++;

    if (decodedSample.length < 25) {
      const bs = new ByteString(bytes);
      decodedSample.push({
        index: i + 1,
        rawPreview: rawStr.slice(0, 20),
        decodedPreview: bs.toLuaLiteral().slice(0, 30),
        isBinary: hasZero || hasHighByte
      });
    }
  }

  const report = {
    totalEntries: entries.length,
    successfullyDecoded,
    ambiguousEntries,
    binaryEntries,
    invalidEntries,
    alphabetSize: alphabet.size,
    rotationRanges,
    sampleDecoded: decodedSample
  };

  fs.writeFileSync(path.resolve(__dirname, 'string-audit.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('Wrote audit/string-audit.json');
  return report;
}

if (require.main === module) {
  const rep = auditStrings(path.resolve(__dirname, '../ByIdiotSandWich.txt'));
  console.log(JSON.stringify(rep, null, 2));
}

module.exports = { auditStrings };
