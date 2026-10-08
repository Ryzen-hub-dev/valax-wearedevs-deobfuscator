const { DEFAULT_LIMITS } = require('../packages/shared/src');
const { TOOL_VERSION } = require('../packages/core/src');

module.exports = async function handler(req, res) {
  return res.status(200).json({
    status: 'healthy',
    engine: 'Valax Source Recovery',
    version: TOOL_VERSION,
    execution: {
      gateway: 'Vercel Node.js',
      admission: 'adaptive',
      nativeWorker: 'C++20 compatible'
    },
    supportedFormats: ['WeAreDevs v1.0.0', 'Generic State-Driven'],
    capabilities: [
      'AST Analysis',
      'String Recovery',
      'Constant Normalization',
      'CFG Reconstruction',
      'Runtime Analysis',
      'Lua/Luau Generation',
      'C++ Native Preflight'
    ],
    limits: DEFAULT_LIMITS,
    timestamp: new Date().toISOString()
  });
};
