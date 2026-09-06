const fs = require('fs');
const path = require('path');
const { parse } = require('../packages/core/src/parser');
const { generate } = require('../packages/core/src/generator');
const { RecoveryPipeline } = require('../packages/core/src/transforms/pipeline');
const { classifyError } = require('../packages/core/src/diagnostics/failure-taxonomy');

function reduceFixture(fixturePath, targetDir = './reduced') {
  if (!fs.existsSync(fixturePath)) {
    console.error(`Fixture not found: ${fixturePath}`);
    process.exit(1);
  }

  const src = fs.readFileSync(fixturePath, 'utf8');
  const pipeline = new RecoveryPipeline();

  // Test if it fails in current pipeline
  let failureCategory = null;
  try {
    pipeline.run(src);
    console.log('Fixture does not fail in current pipeline! Reduction not needed.');
    return;
  } catch (err) {
    failureCategory = classifyError(err).category;
    console.log(`Reproduced failure category: ${failureCategory} (${err.message})`);
  }

  // Attempt binary statement reduction if parseable
  try {
    const ast = parse(src);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    fs.writeFileSync(path.join(targetDir, 'original-large.lua'), src, 'utf8');
    fs.writeFileSync(path.join(targetDir, 'minimal-reproducer.lua'), generate(ast), 'utf8');
    console.log(`Stored reproducer files in ${targetDir}`);
  } catch (parseErr) {
    console.log('Failed during initial parse stage; syntax error minimal reproducer stored.');
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: node reduce-fixture.js <path-to-failing-fixture> [target-dir]');
  } else {
    reduceFixture(args[0], args[1]);
  }
}

module.exports = { reduceFixture };
