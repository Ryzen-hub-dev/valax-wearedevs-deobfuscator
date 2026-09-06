const fs = require('fs');
const path = require('path');
const { parse } = require('../packages/core/src/parser');
const { WeAreDevsAdapter } = require('../packages/core/src/adapters/wearedevs/wearedevs-adapter');

const source = fs.readFileSync(path.resolve(__dirname, '../ByIdiotSandWich.txt'), 'utf8');
const ast = parse(source);
const adapter = new WeAreDevsAdapter();
adapter.extractAndDecode(ast);

const offsets = [-53122, -53591, -53373, -52712, -52791, -53616, -53089];
for (const off of offsets) {
  const resolved = adapter.resolveLookup(off);
  console.log(`Offset ${off} -> ${resolved ? JSON.stringify(resolved.toString('latin1')) : 'NULL'}`);
}
