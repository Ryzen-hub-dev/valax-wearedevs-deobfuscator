/**
 * @valax/api: Product HTTP API Package Entry Point.
 */

const { ProductApiServer } = require('./server');
const { Principal, DevelopmentAuthProvider } = require('./auth');
const { ApiError, ApiErrorCode } = require('./errors');
const { RedactingLogger } = require('./logger');
const {
  ProductJobState,
  TERMINAL_PRODUCT_STATES,
  ACTIVE_PRODUCT_STATES,
  CANCELLABLE_PRODUCT_STATES,
  isValidProductTransition,
  assertValidTransition,
  mapInternalToProductState
} = require('./state-machine');

module.exports = {
  ProductApiServer,
  Principal,
  DevelopmentAuthProvider,
  ApiError,
  ApiErrorCode,
  RedactingLogger,
  ProductJobState,
  TERMINAL_PRODUCT_STATES,
  ACTIVE_PRODUCT_STATES,
  CANCELLABLE_PRODUCT_STATES,
  isValidProductTransition,
  assertValidTransition,
  mapInternalToProductState
};
