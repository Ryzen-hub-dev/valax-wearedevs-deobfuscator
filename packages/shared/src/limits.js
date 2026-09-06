/**
 * Configurable safety and resource limits for untrusted Lua/Luau inputs.
 */
const DEFAULT_LIMITS = {
  MAX_FILE_BYTES: 10 * 1024 * 1024,      // 10 MB
  MAX_SOURCE_LENGTH: 10_000_000,          // 10M characters
  MAX_AST_NODES: 500_000,                 // 500k AST nodes
  MAX_CFG_BLOCKS: 50_000,                 // 50k Basic Blocks
  MAX_ANALYSIS_PASSES: 30,                // Iterative fixpoint passes
  MAX_STRING_ENTRIES: 100_000,            // String pool size limit
  MAX_ANALYSIS_MS: 60_000                 // 60 seconds max analysis time
};

function checkLimit(name, current, limit = DEFAULT_LIMITS[name]) {
  if (limit !== undefined && current > limit) {
    const { LimitExceededError } = require('./errors');
    throw new LimitExceededError(`Resource limit exceeded: ${name} (${current} > ${limit})`);
  }
}

module.exports = {
  DEFAULT_LIMITS,
  checkLimit
};
