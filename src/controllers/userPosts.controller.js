const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const userPostsService = require('../services/userPosts.service');

const getUserPosts = asyncHandler(async (req, res) => {
  const { user, posts, pagination } = await userPostsService.getUserPosts(req.params.userId, req.query);
  new ApiResponse(200, 'Records retrieved successfully', { user, posts }, pagination).send(res);
});

module.exports = { getUserPosts };
