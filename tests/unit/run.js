const { runParserTests } = require('./parser.test');
const { runEvaluatorTests } = require('./evaluator.test');
const { printSummary } = require('../test-framework');

console.log('Running Valax Unit Tests...');
runParserTests();
runEvaluatorTests();
printSummary();
