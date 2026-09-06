const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('../packages/core/src/parser');
const { RecoveryPipeline } = require('../packages/core/src/transforms/pipeline');
const { StructuralFingerprint } = require('../packages/core/src/adapters/structural-fingerprint');
const { StructuralClusterer } = require('../packages/core/src/adapters/clustering');

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function importProtectedFixture(args) {
  let protectedPath = null;
  let originalPath = null;
  let fixtureId = null;
  let variant = 'WeAreDevs';
  let version = 'v1.0.0';
  let seed = 'seed_001';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--protected') protectedPath = args[++i];
    else if (args[i] === '--original') originalPath = args[++i];
    else if (args[i] === '--id') fixtureId = args[++i];
    else if (args[i] === '--variant') variant = args[++i];
    else if (args[i] === '--version') version = args[++i];
    else if (args[i] === '--seed') seed = args[++i];
  }

  if (!protectedPath) {
    console.error('Usage: node import-protected-fixture.js --protected <path> [--original <path>] [--id <id>] [--seed <seed>]');
    process.exit(1);
  }

  const resolvedProtected = path.resolve(process.cwd(), protectedPath);
  if (!fs.existsSync(resolvedProtected)) {
    console.error(`Protected file not found: ${resolvedProtected}`);
    process.exit(1);
  }

  const protectedSource = fs.readFileSync(resolvedProtected, 'utf8');
  if (!fixtureId) {
    fixtureId = path.basename(resolvedProtected, path.extname(resolvedProtected));
  }

  const targetDir = path.resolve(__dirname, '../protected-corpus', fixtureId);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Copy protected source
  fs.writeFileSync(path.join(targetDir, 'protected.lua'), protectedSource, 'utf8');

  // Handle original source
  let originalSource = null;
  let originalHash = null;
  if (originalPath && fs.existsSync(path.resolve(process.cwd(), originalPath))) {
    originalSource = fs.readFileSync(path.resolve(process.cwd(), originalPath), 'utf8');
    fs.writeFileSync(path.join(targetDir, 'original.lua'), originalSource, 'utf8');
    originalHash = sha256(originalSource);
  }

  // Parse and Fingerprint
  const ast = parse(protectedSource);
  const fingerprinter = new StructuralFingerprint();
  const fingerprint = fingerprinter.extract(ast, protectedSource);
  fs.writeFileSync(path.join(targetDir, 'fingerprint.json'), JSON.stringify(fingerprint, null, 2), 'utf8');

  const clusterer = new StructuralClusterer();
  const family = clusterer.classify(fingerprint);

  // Run pipeline
  const pipeline = new RecoveryPipeline();
  const result = pipeline.run(protectedSource);
  fs.writeFileSync(path.join(targetDir, 'recovered.lua'), result.code, 'utf8');
  fs.writeFileSync(path.join(targetDir, 'report.json'), JSON.stringify(result.report, null, 2), 'utf8');

  const metadata = {
    fixtureId,
    sourceCategory: 'protected_production_sample',
    complexityLevel: 5,
    language: 'lua',
    generator: variant,
    generatorVersion: version,
    seed,
    structuralFamily: family,
    sourceHash: originalHash,
    protectedHash: sha256(protectedSource),
    recoveredHash: sha256(result.code),
    recoveryLevel: result.report.recoveryLevel,
    importedAt: new Date().toISOString()
  };

  fs.writeFileSync(path.join(targetDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
  console.log(`Imported ${fixtureId} successfully into protected-corpus/${fixtureId} (Family: ${family}, Level: ${result.report.recoveryLevel}).`);
  return metadata;
}

if (require.main === module) {
  importProtectedFixture(process.argv.slice(2));
}

module.exports = { importProtectedFixture };
