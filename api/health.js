const { DEFAULT_LIMITS } = require('../packages/shared/src');

module.exports = async function handler(req, res) {
  return res.status(200).json({
    status: 'healthy',
    engine: 'Valax Source Recovery',
    version: '1.0.0',
    supportedFormats: ['WeAreDevs v1.0.0', 'Generic State-Driven'],
    capabilities: [
      'AST Analysis',
      'String Recovery',
      'Constant Normalization',
      'CFG Reconstruction',
      'Runtime Analysis',
      'Lua/Luau Generation'
    ],
    limits: DEFAULT_LIMITS,
    timestamp: new Date().toISOString()
  });
};
