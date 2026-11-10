const ApiError = require('../utils/ApiError');

function authorizeRole(...allowedRoles) {
  return function authorize(req, res, next) {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      next(ApiError.forbidden('You do not have permission to perform this action'));
      return;
    }
    next();
  };
}

module.exports = authorizeRole;
