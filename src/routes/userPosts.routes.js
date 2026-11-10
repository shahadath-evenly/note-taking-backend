const express = require('express');
const validateRequest = require('../middlewares/validateRequest');
const listUserPostsQuerySchema = require('../validators/posts/listUserPosts.schema');
const { getUserPosts } = require('../controllers/userPosts.controller');

const router = express.Router();

// Public: posts are visible to everyone, so this route intentionally has no
// authenticate/authorizeRole middleware.
router.get('/:userId/posts', validateRequest(listUserPostsQuerySchema, 'query'), getUserPosts);

module.exports = router;
