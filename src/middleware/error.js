// ============================================================
//  Central error handling + 404.
// ============================================================
import { env } from '../config/env.js';

export function notFound(req, res, next) {
  res
    .status(404)
    .json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let code = err.code;

  // --- Mongoose / MongoDB translations ---
  if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  } else if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `${field} already in use`;
    code = 'DUPLICATE';
  } else if (err.name === 'JsonWebTokenError') {
    status = 401;
    message = 'Invalid token';
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    status = 400;
    message = `File too large (max ${env.upload.maxMb} MB)`;
  } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    status = 400;
    message = 'Unexpected file field';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Payload too large';
  }

  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error('💥', err);
  }

  const body = { success: false, message };
  if (code) body.code = code;
  if (!env.isProd && status >= 500) body.stack = err.stack;

  res.status(status).json(body);
}
