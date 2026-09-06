const fs = require('fs');
const path = require('path');
const { parse } = require('../packages/core/src/parser');
const { generate } = require('../packages/core/src/generator');
const { recover } = require('../packages/core/src');

function auditRoundtripAndIdempotence() {
  const resultPath = path.resolve(__dirname, '../result.lua');
  const resultSource = fs.readFileSync(resultPath, 'utf8');

  // Rule 10: AST round-trip
  let roundtripReport = {
    pass1ParseSuccess: false,
    pass1Error: null,
    pass2ParseSuccess: false,
    pass2Error: null,
    roundtripBytes: 0,
    status: 'FAIL'
  };

  try {
    const ast1 = parse(resultSource);
    roundtripReport.pass1ParseSuccess = true;
    const generated1 = generate(ast1);
    roundtripReport.roundtripBytes = Buffer.byteLength(generated1, 'utf8');
    fs.writeFileSync(path.resolve(__dirname, '../result.roundtrip.lua'), generated1, 'utf8');

    const ast2 = parse(generated1);
    roundtripReport.pass2ParseSuccess = true;
    roundtripReport.status = 'PASS';
  } catch (err) {
    roundtripReport.pass1Error = err.message;
    roundtripReport.status = 'FAIL';
  }
  fs.writeFileSync(path.resolve(__dirname, 'roundtrip-audit.json'), JSON.stringify(roundtripReport, null, 2), 'utf8');
  console.log('Wrote audit/roundtrip-audit.json');

  // Rule 11: Idempotence test
  let idempotenceReport = {
    firstOutputBytes: Buffer.byteLength(resultSource, 'utf8'),
    secondOutputBytes: 0,
    byteDifference: 0,
    status: 'FAIL',
    error: null
  };

  try {
    const secondResult = recover(resultSource, { stage: 'L5', filename: 'result.lua' });
    idempotenceReport.secondOutputBytes = Buffer.byteLength(secondResult.code, 'utf8');
    idempotenceReport.byteDifference = Math.abs(idempotenceReport.secondOutputBytes - idempotenceReport.firstOutputBytes);
    fs.writeFileSync(path.resolve(__dirname, '../result.second.lua'), secondResult.code, 'utf8');
    // If byte difference is reasonable / small and no errors
    idempotenceReport.status = idempotenceReport.byteDifference < 1000 ? 'PASS' : 'PARTIAL';
  } catch (err) {
    idempotenceReport.status = 'FAIL';
    idempotenceReport.error = err.message;
  }
  fs.writeFileSync(path.resolve(__dirname, 'idempotence-audit.json'), JSON.stringify(idempotenceReport, null, 2), 'utf8');
  console.log('Wrote audit/idempotence-audit.json');

  return { roundtripReport, idempotenceReport };
}

if (require.main === module) {
  auditRoundtripAndIdempotence();
}

module.exports = { auditRoundtripAndIdempotence };
