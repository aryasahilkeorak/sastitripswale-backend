// A small operational error class so controllers can throw HTTP errors cleanly.
export default class ApiError extends Error {
  constructor(statusCode, message, code = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code; // optional machine-readable code, e.g. 'TOKEN_EXPIRED'
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(msg = 'Bad request', code) {
    return new ApiError(400, msg, code);
  }
  static unauthorized(msg = 'Unauthorized', code) {
    return new ApiError(401, msg, code);
  }
  static forbidden(msg = 'Forbidden', code) {
    return new ApiError(403, msg, code);
  }
  static notFound(msg = 'Not found', code) {
    return new ApiError(404, msg, code);
  }
  static conflict(msg = 'Conflict', code) {
    return new ApiError(409, msg, code);
  }
}
