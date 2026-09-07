/**
 * Canonical Product Job State Machine and Transition Validator.
 */

const ProductJobState = {
  QUEUED: 'QUEUED',
  LEASED: 'LEASED',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  TIMED_OUT: 'TIMED_OUT',
  CANCELLED: 'CANCELLED'
};

const TERMINAL_PRODUCT_STATES = new Set([
  ProductJobState.SUCCEEDED,
  ProductJobState.FAILED,
  ProductJobState.TIMED_OUT,
  ProductJobState.CANCELLED
]);

const ACTIVE_PRODUCT_STATES = new Set([
  ProductJobState.QUEUED,
  ProductJobState.LEASED,
  ProductJobState.RUNNING
]);

const CANCELLABLE_PRODUCT_STATES = new Set([
  ProductJobState.QUEUED,
  ProductJobState.LEASED,
  ProductJobState.RUNNING
]);

/**
 * Validates whether a state transition is legal according to canonical product FSM rules.
 *
 * @param {string} fromState
 * @param {string} toState
 * @returns {boolean}
 */
function isValidProductTransition(fromState, toState) {
  if (!ProductJobState[fromState] || !ProductJobState[toState]) {
    return false;
  }
  if (fromState === toState) {
    return true;
  }
  // Terminal states cannot transition to ANY state
  if (TERMINAL_PRODUCT_STATES.has(fromState)) {
    return false;
  }

  switch (fromState) {
    case ProductJobState.QUEUED:
      return [
        ProductJobState.LEASED,
        ProductJobState.RUNNING,
        ProductJobState.CANCELLED,
        ProductJobState.TIMED_OUT,
        ProductJobState.FAILED
      ].includes(toState);

    case ProductJobState.LEASED:
      return [
        ProductJobState.RUNNING,
        ProductJobState.QUEUED, // Unleased/re-queued on timeout/crash
        ProductJobState.CANCELLED,
        ProductJobState.TIMED_OUT,
        ProductJobState.FAILED
      ].includes(toState);

    case ProductJobState.RUNNING:
      return [
        ProductJobState.SUCCEEDED,
        ProductJobState.FAILED,
        ProductJobState.TIMED_OUT,
        ProductJobState.CANCELLED,
        ProductJobState.QUEUED // Re-queued on worker lease reclaim
      ].includes(toState);

    default:
      return false;
  }
}

/**
 * Asserts transition validity; throws on illegal transition.
 */
function assertValidTransition(fromState, toState) {
  if (!isValidProductTransition(fromState, toState)) {
    const err = new Error(`Illegal product job state transition: ${fromState} -> ${toState}`);
    err.code = 'ILLEGAL_STATE_TRANSITION';
    throw err;
  }
}

/**
 * Maps queue/worker internal state to canonical product state.
 */
function mapInternalToProductState(internalState) {
  switch (internalState) {
    case 'QUEUED':
      return ProductJobState.QUEUED;
    case 'LEASED':
      return ProductJobState.LEASED;
    case 'RUNNING':
      return ProductJobState.RUNNING;
    case 'COMPLETED':
      return ProductJobState.SUCCEEDED;
    case 'FAILED':
      return ProductJobState.FAILED;
    case 'TIMED_OUT':
      return ProductJobState.TIMED_OUT;
    case 'CANCELLED':
      return ProductJobState.CANCELLED;
    case 'RESOURCE_LIMIT':
      return ProductJobState.FAILED;
    default:
      return ProductJobState.FAILED;
  }
}

module.exports = {
  ProductJobState,
  TERMINAL_PRODUCT_STATES,
  ACTIVE_PRODUCT_STATES,
  CANCELLABLE_PRODUCT_STATES,
  isValidProductTransition,
  assertValidTransition,
  mapInternalToProductState
};
