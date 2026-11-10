const express = require('express');
const authenticate = require('../middlewares/authenticate');
const authorizeRole = require('../middlewares/authorizeRole');
const validateRequest = require('../middlewares/validateRequest');
const { ROLES } = require('../constants/roles');
const createUserSchema = require('../validators/users/createUser.schema');
const updateUserSchema = require('../validators/users/updateUser.schema');
const listUsersQuerySchema = require('../validators/users/listUsers.schema');
const groupByInterestsQuerySchema = require('../validators/users/groupByInterests.schema');
const {
  listUsers,
  createUser,
  getUser,
  updateUser,
  deleteUser,
} = require('../controllers/adminUsers.controller');
const { getGroupedByInterests } = require('../controllers/interestGroups.controller');

const router = express.Router();

router.use(authenticate, authorizeRole(ROLES.ADMIN));

// Registered before `/:id` so the literal path is matched first; otherwise
// Express would treat "grouped-by-interests" as an `:id` value.
router.get(
  '/grouped-by-interests',
  validateRequest(groupByInterestsQuerySchema, 'query'),
  getGroupedByInterests
);

router.get('/', validateRequest(listUsersQuerySchema, 'query'), listUsers);
router.post('/', validateRequest(createUserSchema), createUser);
router.get('/:id', getUser);
router.patch('/:id', validateRequest(updateUserSchema), updateUser);
router.delete('/:id', deleteUser);

module.exports = router;
