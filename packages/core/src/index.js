const lexer = require('./lexer');
const parser = require('./parser');
const ast = require('./ast');
const evaluator = require('./evaluator');
const cfg = require('./cfg');
const transforms = require('./transforms');
const detectors = require('./detectors');
const adapters = require('./adapters');
const generator = require('./generator');
const analysis = require('./analysis');
const { RecoveryService, ExitCode, TOOL_VERSION, SCHEMA_VERSION } = require('./service/recovery-service');

function recover(source, options = {}) {
  const pipeline = new transforms.RecoveryPipeline(options);
  return pipeline.run(source, options.filename || 'input.lua');
}

module.exports = {
  lexer,
  parser,
  ast,
  evaluator,
  cfg,
  transforms,
  detectors,
  adapters,
  generator,
  analysis,
  recover,
  RecoveryService,
  ExitCode,
  TOOL_VERSION,
  SCHEMA_VERSION
};
