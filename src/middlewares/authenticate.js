const ApiError = require('../utils/ApiError');
const { verifyToken } = require('../utils/jwt');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    next(ApiError.unauthorized('Authentication token is missing'));
    return;
  }

  try {
    const payload = verifyToken(token);
    req.user = { userId: payload.userId, role: payload.role };
    next();
  } catch {
    next(ApiError.unauthorized('Invalid or expired authentication token'));
  }
}

module.exports = authenticate;
