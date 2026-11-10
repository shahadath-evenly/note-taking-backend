const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const authService = require('../services/auth.service');

const register = asyncHandler(async (req, res) => {
  const user = await authService.registerUser(req.body);
  new ApiResponse(201, 'User registered successfully', user).send(res);
});

const login = asyncHandler(async (req, res) => {
  const { user, token } = await authService.loginUser(req.body);
  new ApiResponse(200, 'Login successful', { user, token }).send(res);
});

const getMe = asyncHandler(async (req, res) => {
  const user = await authService.getCurrentUser(req.user.userId);
  new ApiResponse(200, 'Current user retrieved successfully', user).send(res);
});

module.exports = { register, login, getMe };
