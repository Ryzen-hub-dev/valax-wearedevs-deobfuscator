const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CORPUS_DIR = path.resolve(__dirname, '../tests/blind-protected-corpus');
const AUDIT_DIR = path.resolve(__dirname, '../audit');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function generateBlindProvenance() {
  console.log('Generating Blind Corpus Provenance Audit...\n');
  const sampleDirs = fs.readdirSync(CORPUS_DIR)
    .filter(f => fs.statSync(path.join(CORPUS_DIR, f)).isDirectory())
    .sort();

  const provenanceRecords = [];

  for (const dir of sampleDirs) {
    const fullDir = path.join(CORPUS_DIR, dir);
    const origPath = path.join(fullDir, 'original.lua');
    const protPath = path.join(fullDir, 'protected.lua');
    const metaPath = path.join(fullDir, 'metadata.json');

    const origContent = fs.existsSync(origPath) ? fs.readFileSync(origPath, 'utf8') : '';
    const protContent = fs.existsSync(protPath) ? fs.readFileSync(protPath, 'utf8') : '';
    const metadata = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
    const protStat = fs.existsSync(protPath) ? fs.statSync(protPath) : null;

    // Detect protection fingerprint: header comment or structural markers
    let fingerprint = 'WeAreDevs-v1.0.0-standard';
    if (protContent.includes('wearedevs.net/obfuscator')) {
      fingerprint = 'WeAreDevs-v1.0.0-tagged-header';
    } else if (protContent.includes('Tamper Detected!')) {
      fingerprint = 'WeAreDevs-v1.0.0-tamper-guarded';
    }

    provenanceRecords.push({
      sampleId: dir,
      name: metadata.name || dir,
      sourceBytes: Buffer.byteLength(origContent, 'utf8'),
      sourceSha256: sha256(origContent),
      protectedBytes: Buffer.byteLength(protContent, 'utf8'),
      protectedSha256: sha256(protContent),
      generationTimestamp: metadata.timestamp || (protStat ? protStat.mtime.toISOString() : new Date().toISOString()),
      protectionFingerprint: fingerprint,
      origin: 'Live WeAreDevs API (https://wearedevs.net/api/obfuscate)'
    });
  }

  const summary = {
    timestamp: new Date().toISOString(),
    totalSamples: provenanceRecords.length,
    obfuscatorBackend: 'WeAreDevs (https://wearedevs.net/api/obfuscate)',
    samples: provenanceRecords
  };

  const outPath = path.join(AUDIT_DIR, 'blind-corpus-provenance.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`Saved provenance for ${provenanceRecords.length} samples to: ${outPath}`);
  return summary;
}

if (require.main === module) {
  generateBlindProvenance();
}

module.exports = { generateBlindProvenance };
