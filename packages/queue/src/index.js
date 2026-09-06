/**
 * @valax/queue:
 * Job queue and leasing scheduler exports.
 */

const { JobState, TERMINAL_STATES, isValidTransition } = require('./types');
const { InMemoryJobQueue } = require('./in-memory-queue');
const { RedisQueueAdapter, MinimalRedisClient, SynchronousRedisClient } = require('./redis-queue-adapter');

module.exports = {
  JobState,
  TERMINAL_STATES,
  isValidTransition,
  InMemoryJobQueue,
  RedisQueueAdapter,
  MinimalRedisClient,
  SynchronousRedisClient
};
