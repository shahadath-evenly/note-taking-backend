const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { signToken } = require('../utils/jwt');
const { ROLES } = require('../constants/roles');

async function registerUser({ firstName, lastName, email, password }) {
  // role is always forced to ROLES.USER here, ignoring any other value that
  // might otherwise have reached this point, so public registration can
  // never create an admin.
  const user = await User.create({ firstName, lastName, email, password, role: ROLES.USER });
  return user.toJSON();
}

async function loginUser({ email, password }) {
  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const token = signToken({ userId: user._id.toString(), role: user.role });

  return { user: user.toJSON(), token };
}

async function getCurrentUser(userId) {
  const user = await User.findById(userId);

  if (!user) {
    throw ApiError.unauthorized('Authenticated user no longer exists');
  }

  return user.toJSON();
}

module.exports = { registerUser, loginUser, getCurrentUser };
