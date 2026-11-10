const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const userRepository = require('../repositories/user.repository');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');

async function getUserPosts(userId, query) {
  if (!mongoose.isValidObjectId(userId)) {
    throw ApiError.badRequest('Invalid user ID');
  }

  const { page, limit, skip } = parsePagination(query);

  const [result] = await userRepository.getUserWithPosts(
    new mongoose.Types.ObjectId(userId),
    { skip, limit }
  );

  if (!result) {
    throw ApiError.notFound('User not found');
  }

  const { posts, totalPosts, ...user } = result;

  return {
    user,
    posts,
    pagination: buildPaginationMeta({ page, limit, total: totalPosts }),
  };
}

module.exports = { getUserPosts };
