const express = require('express');
const validateRequest = require('../middlewares/validateRequest');
const authenticate = require('../middlewares/authenticate');
const authRateLimiter = require('../middlewares/authRateLimiter');
const registerSchema = require('../validators/auth/register.schema');
const loginSchema = require('../validators/auth/login.schema');
const { register, login, getMe } = require('../controllers/auth.controller');

const router = express.Router();

router.post('/register', authRateLimiter, validateRequest(registerSchema), register);
router.post('/login', authRateLimiter, validateRequest(loginSchema), login);
router.get('/me', authenticate, getMe);

module.exports = router;
