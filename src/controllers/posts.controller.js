const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const postService = require('../services/post.service');

const listPosts = asyncHandler(async (req, res) => {
  const { posts, pagination } = await postService.listPosts(req.query);
  new ApiResponse(200, 'Records retrieved successfully', posts, pagination).send(res);
});

const createPost = asyncHandler(async (req, res) => {
  const post = await postService.createPost(req.user.userId, req.body);
  new ApiResponse(201, 'Post created successfully', post).send(res);
});

module.exports = { listPosts, createPost };
