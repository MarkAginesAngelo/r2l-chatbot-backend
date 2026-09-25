class AppError extends Error {
  constructor(message, statusCode = 500, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

const logger = require('../config/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';

  logger.error(`${req.method} ${req.originalUrl} -> ${err.message}`, {
    stack: err.stack,
    statusCode,
  });

  res.status(statusCode).json({
    error: {
      message: err.message || 'Internal Server Error',
      ...(err.details ? { details: err.details } : {}),
      ...(isProd ? {} : { stack: err.stack }),
    },
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `Route not found: ${req.method} ${req.originalUrl}` } });
}

module.exports = { AppError, errorHandler, notFoundHandler };
