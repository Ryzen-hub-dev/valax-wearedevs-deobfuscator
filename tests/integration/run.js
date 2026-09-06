const { runPipelineTests } = require('./pipeline.test');
const { printSummary } = require('../test-framework');

console.log('Running Valax Integration Tests...');
runPipelineTests();
printSummary();
