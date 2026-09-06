const fs = require('fs');
const path = require('path');
const { importProtectedFixture } = require('./import-protected-fixture');

function batchImport() {
  const incomingDir = path.resolve(__dirname, '../incoming-protected');
  if (!fs.existsSync(incomingDir)) {
    fs.mkdirSync(incomingDir, { recursive: true });
    console.log('Created incoming-protected/ directory.');
  }

  const files = fs.readdirSync(incomingDir).filter(f => f.endsWith('.lua') || f.endsWith('.txt'));
  if (files.length === 0) {
    console.log('No pending files found in incoming-protected/. Place protected fixtures and metadata.json files here for automated batch ingestion.');
    return { importedCount: 0 };
  }

  let importedCount = 0;
  for (const f of files) {
    const fullPath = path.join(incomingDir, f);
    const id = path.basename(f, path.extname(f));
    console.log(`Ingesting incoming fixture: ${f}...`);
    try {
      importProtectedFixture([
        '--protected', fullPath,
        '--id', id
      ]);
      importedCount++;
    } catch (e) {
      console.error(`Failed to ingest ${f}:`, e.message);
    }
  }

  console.log(`Batch import finished: ${importedCount} fixtures imported.`);
  return { importedCount };
}

if (require.main === module) {
  batchImport();
}

module.exports = { batchImport };
