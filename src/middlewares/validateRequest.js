const ApiError = require('../utils/ApiError');

function validateRequest(schema, source = 'body') {
  return async function validate(req, res, next) {
    try {
      const validated = await schema.validate(req[source], {
        abortEarly: false,
        stripUnknown: true,
      });
      req[source] = validated;
      next();
    } catch (error) {
      if (error.name !== 'ValidationError') {
        next(error);
        return;
      }

      const details = Array.isArray(error.inner) && error.inner.length > 0
        ? error.inner.map((fieldError) => ({ field: fieldError.path, message: fieldError.message }))
        : [{ field: error.path, message: error.message }];

      next(ApiError.badRequest('Validation failed', details));
    }
  };
}

module.exports = validateRequest;
