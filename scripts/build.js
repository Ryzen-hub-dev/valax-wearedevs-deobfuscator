const fs = require('fs');
const path = require('path');

console.log('Building Valax Source Recovery package...');

// Verify essential files
const requiredPaths = [
  'bin/valax.js',
  'packages/core/src/index.js',
  'packages/shared/src/index.js'
];

for (const rel of requiredPaths) {
  const full = path.resolve(__dirname, '..', rel);
  if (!fs.existsSync(full)) {
    console.error(`Build error: Missing required file: ${rel}`);
    process.exit(1);
  }
}

// Ensure CLI executable flag on Unix/Linux
try {
  const binPath = path.resolve(__dirname, '../bin/valax.js');
  fs.chmodSync(binPath, 0o755);
} catch (e) {
  // Ignored on Windows
}

console.log('Build complete and verified! [PASS]');
process.exit(0);
