const Post = require('../models/Post');

function findMany({ filter, sort, skip, limit }) {
  return Post.find(filter).sort(sort).skip(skip).limit(limit);
}

function count(filter) {
  return Post.countDocuments(filter);
}

function create(data) {
  return Post.create(data);
}

module.exports = { findMany, count, create };
