/**
 * Queue and Job State Definitions:
 * Canonical finite state machine for recovery jobs in hosted infrastructure.
 */

const JobState = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  TIMED_OUT: 'TIMED_OUT',
  RESOURCE_LIMIT: 'RESOURCE_LIMIT'
};

const TERMINAL_STATES = new Set([
  JobState.COMPLETED,
  JobState.FAILED,
  JobState.CANCELLED,
  JobState.TIMED_OUT,
  JobState.RESOURCE_LIMIT
]);

/**
 * Validates if a state transition is legal.
 * 
 * Allowed transitions:
 * QUEUED -> RUNNING, CANCELLED, TIMED_OUT
 * RUNNING -> COMPLETED, FAILED, CANCELLED, TIMED_OUT, RESOURCE_LIMIT, QUEUED (lease reclaim)
 * Terminal states cannot transition to any other state.
 */
function isValidTransition(fromState, toState) {
  if (fromState === toState) return true;
  if (TERMINAL_STATES.has(fromState)) return false;

  if (fromState === JobState.QUEUED) {
    return [JobState.RUNNING, JobState.CANCELLED, JobState.TIMED_OUT].includes(toState);
  }

  if (fromState === JobState.RUNNING) {
    return [
      JobState.COMPLETED,
      JobState.FAILED,
      JobState.CANCELLED,
      JobState.TIMED_OUT,
      JobState.RESOURCE_LIMIT,
      JobState.QUEUED // Stale lease reclaim re-enqueues
    ].includes(toState);
  }

  return false;
}

module.exports = {
  JobState,
  TERMINAL_STATES,
  isValidTransition
};
