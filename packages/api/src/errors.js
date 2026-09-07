/**
 * Standard Product Error Taxonomy and Formatting.
 */

const ApiErrorCode = {
  INVALID_FILE: 'INVALID_FILE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_ENCODING: 'INVALID_ENCODING',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  QUEUE_SATURATED: 'QUEUE_SATURATED',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  JOB_NOT_CANCELLABLE: 'JOB_NOT_CANCELLABLE',
  ARTIFACT_NOT_FOUND: 'ARTIFACT_NOT_FOUND',
  ARTIFACT_EXPIRED: 'ARTIFACT_EXPIRED',
  WORKER_FAILED: 'WORKER_FAILED',
  RECOVERY_FAILED: 'RECOVERY_FAILED',
  TIMEOUT: 'TIMEOUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT'
};

const HTTP_STATUS_MAP = {
  [ApiErrorCode.INVALID_FILE]: 400,
  [ApiErrorCode.INVALID_ENCODING]: 400,
  [ApiErrorCode.FILE_TOO_LARGE]: 413,
  [ApiErrorCode.UNAUTHORIZED]: 401,
  [ApiErrorCode.FORBIDDEN]: 403,
  [ApiErrorCode.JOB_NOT_FOUND]: 404,
  [ApiErrorCode.ARTIFACT_NOT_FOUND]: 404,
  [ApiErrorCode.ARTIFACT_EXPIRED]: 410,
  [ApiErrorCode.JOB_NOT_CANCELLABLE]: 409,
  [ApiErrorCode.IDEMPOTENCY_CONFLICT]: 409,
  [ApiErrorCode.RATE_LIMITED]: 429,
  [ApiErrorCode.QUOTA_EXCEEDED]: 429,
  [ApiErrorCode.QUEUE_SATURATED]: 503,
  [ApiErrorCode.TIMEOUT]: 504,
  [ApiErrorCode.WORKER_FAILED]: 502,
  [ApiErrorCode.RECOVERY_FAILED]: 500,
  [ApiErrorCode.INTERNAL_ERROR]: 500
};

class ApiError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [status]
   * @param {object} [details]
   */
  constructor(code, message, status, details = {}) {
    super(message);
    this.code = code || ApiErrorCode.INTERNAL_ERROR;
    this.status = status || HTTP_STATUS_MAP[this.code] || 500;
    this.details = details;
  }

  toResponse(requestId) {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId: requestId || 'unknown'
      }
    };
  }
}

module.exports = {
  ApiErrorCode,
  HTTP_STATUS_MAP,
  ApiError
};
