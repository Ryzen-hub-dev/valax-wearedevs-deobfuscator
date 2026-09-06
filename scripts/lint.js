const fs = require('fs');
const path = require('path');
const vm = require('vm');

function getAllJsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        results = results.concat(getAllJsFiles(fullPath));
      }
    } else if (file.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

const rootDir = path.resolve(__dirname, '..');
const jsFiles = getAllJsFiles(path.join(rootDir, 'packages'))
  .concat(getAllJsFiles(path.join(rootDir, 'tests')))
  .concat(getAllJsFiles(path.join(rootDir, 'bin')));

let errors = 0;
console.log(`Linting ${jsFiles.length} JavaScript files...`);

for (const file of jsFiles) {
  try {
    const code = fs.readFileSync(file, 'utf8');
    new vm.Script(code, { filename: file });
  } catch (err) {
    console.error(`Syntax Error in ${file}: ${err.message}`);
    errors++;
  }
}

if (errors > 0) {
  console.error(`Lint failed with ${errors} error(s).`);
  process.exit(1);
} else {
  console.log('All files passed syntax linting! [PASS]');
  process.exit(0);
}
