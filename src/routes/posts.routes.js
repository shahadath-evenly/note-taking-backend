const express = require('express');
const authenticate = require('../middlewares/authenticate');
const validateRequest = require('../middlewares/validateRequest');
const createPostSchema = require('../validators/posts/createPost.schema');
const listPostsQuerySchema = require('../validators/posts/listPosts.schema');
const { listPosts, createPost } = require('../controllers/posts.controller');

const router = express.Router();

// Public: posts are visible to everyone, so listing has no auth middleware.
router.get('/', validateRequest(listPostsQuerySchema, 'query'), listPosts);

// Creating a post requires authentication; ownership always comes from the
// verified JWT (req.user.userId), never from the request body.
router.post('/', authenticate, validateRequest(createPostSchema), createPost);

module.exports = router;
