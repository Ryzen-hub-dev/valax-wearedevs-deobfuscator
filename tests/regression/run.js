const { runRegressionTests } = require('./root-fixture.test');
const { printSummary } = require('../test-framework');

console.log('Running Valax Real-World Regression Tests...');
runRegressionTests();
printSummary();
