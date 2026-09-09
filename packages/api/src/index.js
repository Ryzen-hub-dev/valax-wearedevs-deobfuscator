/**
 * @valax/api: Product HTTP API Package Entry Point.
 */

const { ProductApiServer } = require('./server');
const { Principal, DevelopmentAuthProvider } = require('./auth');
const { MongoIdentityStore, MemoryMongoCollection } = require('./auth/identity-store');
const { SessionStore, MemorySessionStore, MongoSessionStore } = require('./auth/session-store');
const { DiscordOAuthController } = require('./auth/discord-oauth');
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

let defaultServerInstance = null;

function getOrCreateServer() {
  if (!defaultServerInstance) {
    let RecoveryGateway;
    try {
      RecoveryGateway = require('@valax/gateway').RecoveryGateway;
    } catch {
      RecoveryGateway = require('../../gateway/src').RecoveryGateway;
    }
    const gateway = new RecoveryGateway();
    defaultServerInstance = new ProductApiServer({ gateway });
  }
  return defaultServerInstance;
}

/**
 * Serverless HTTP request handler for Vercel, AWS Lambda, and cloud platforms.
 */
function handler(req, res) {
  const server = getOrCreateServer();
  return server._handleRequest(req, res);
}

// Attach all exports to the handler function so destructured require works seamlessly
handler.ProductApiServer = ProductApiServer;
handler.Principal = Principal;
handler.DevelopmentAuthProvider = DevelopmentAuthProvider;
handler.MongoIdentityStore = MongoIdentityStore;
handler.MemoryMongoCollection = MemoryMongoCollection;
handler.SessionStore = SessionStore;
handler.MemorySessionStore = MemorySessionStore;
handler.MongoSessionStore = MongoSessionStore;
handler.DiscordOAuthController = DiscordOAuthController;
handler.ApiError = ApiError;
handler.ApiErrorCode = ApiErrorCode;
handler.RedactingLogger = RedactingLogger;
handler.ProductJobState = ProductJobState;
handler.TERMINAL_PRODUCT_STATES = TERMINAL_PRODUCT_STATES;
handler.ACTIVE_PRODUCT_STATES = ACTIVE_PRODUCT_STATES;
handler.CANCELLABLE_PRODUCT_STATES = CANCELLABLE_PRODUCT_STATES;
handler.isValidProductTransition = isValidProductTransition;
handler.assertValidTransition = assertValidTransition;
handler.mapInternalToProductState = mapInternalToProductState;
handler.default = handler;

module.exports = handler;
