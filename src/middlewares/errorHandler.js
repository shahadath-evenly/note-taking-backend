const config = require('../config/env');
const ApiError = require('../utils/ApiError');

function normalizeError(err) {
  if (err instanceof ApiError) {
    return err;
  }

  if (err.name === 'ValidationError' && err.errors) {
    const details = Object.values(err.errors).map((fieldError) => ({
      field: fieldError.path,
      message: fieldError.message,
    }));
    return new ApiError(400, 'Validation failed', details);
  }

  if (err.name === 'CastError') {
    return new ApiError(400, `Invalid value for ${err.path}`);
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return new ApiError(409, `${field} already exists`);
  }

  const message = config.nodeEnv === 'production' ? 'Internal server error' : err.message;
  return new ApiError(500, message);
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const apiError = normalizeError(err);

  if (apiError.statusCode >= 500) {
    console.error(err);
  }

  const body = {
    success: false,
    message: apiError.message,
  };

  if (apiError.errors) {
    body.errors = apiError.errors;
  }

  if (config.nodeEnv !== 'production' && apiError.statusCode >= 500) {
    body.stack = err.stack;
  }

  res.status(apiError.statusCode).json(body);
}

module.exports = errorHandler;
