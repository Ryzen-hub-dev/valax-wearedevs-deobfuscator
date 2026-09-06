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

function ingestByMethion() {
  const methionSrcPath = 'c:/Users/ksjz1/Downloads/ByMethion.txt';
  if (!fs.existsSync(methionSrcPath)) {
    console.error(`ByMethion.txt not found at ${methionSrcPath}`);
    process.exit(1);
  }

  const protectedSource = fs.readFileSync(methionSrcPath, 'utf8');
  const targetDir = path.resolve(__dirname, '../protected-corpus/fixture_unpaired_0002_bymethion');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Write protected.lua
  fs.writeFileSync(path.join(targetDir, 'protected.lua'), protectedSource, 'utf8');

  // Parse & Fingerprint
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
    fixtureId: 'fixture_unpaired_0002_bymethion',
    sourceCategory: 'unpaired_protected_production_sample',
    complexityLevel: 4,
    language: 'lua',
    generator: 'WeAreDevs',
    generatorVersion: 'v1.0.0',
    seed: 'seed_002',
    structuralFamily: family,
    sourceHash: null,
    protectedHash: sha256(protectedSource),
    recoveredHash: sha256(result.code),
    recoveryLevel: result.report.recoveryLevel,
    pairedOriginalAvailable: false,
    semanticEligible: false,
    fixtureType: 'UNPAIRED_REAL_PROTECTED_FIXTURE',
    importedAt: new Date().toISOString()
  };

  fs.writeFileSync(path.join(targetDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
  console.log(`Ingested fixture_unpaired_0002_bymethion successfully into ${targetDir}`);
  return { metadata, report: result.report, fingerprint, family };
}

if (require.main === module) {
  ingestByMethion();
}

module.exports = { ingestByMethion };
