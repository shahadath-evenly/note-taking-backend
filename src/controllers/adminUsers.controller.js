const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const userService = require('../services/user.service');

const listUsers = asyncHandler(async (req, res) => {
  const { users, pagination } = await userService.listUsers(req.query);
  new ApiResponse(200, 'Records retrieved successfully', users, pagination).send(res);
});

const createUser = asyncHandler(async (req, res) => {
  const user = await userService.createUser(req.body);
  new ApiResponse(201, 'User created successfully', user).send(res);
});

const getUser = asyncHandler(async (req, res) => {
  const user = await userService.getUserById(req.params.id);
  new ApiResponse(200, 'User retrieved successfully', user).send(res);
});

const updateUser = asyncHandler(async (req, res) => {
  const user = await userService.updateUser(req.params.id, req.body);
  new ApiResponse(200, 'User updated successfully', user).send(res);
});

const deleteUser = asyncHandler(async (req, res) => {
  await userService.deleteUser(req.params.id, req.user.userId);
  new ApiResponse(200, 'User deleted successfully', null).send(res);
});

module.exports = { listUsers, createUser, getUser, updateUser, deleteUser };
