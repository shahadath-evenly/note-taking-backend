const express = require('express');
const authenticate = require('../middlewares/authenticate');
const authorizeRole = require('../middlewares/authorizeRole');
const validateRequest = require('../middlewares/validateRequest');
const { ROLES } = require('../constants/roles');
const listNotesQuerySchema = require('../validators/notes/listNotes.schema');
const { listAllNotes } = require('../controllers/adminNotes.controller');

const router = express.Router();

router.use(authenticate, authorizeRole(ROLES.ADMIN));

router.get('/', validateRequest(listNotesQuerySchema, 'query'), listAllNotes);

module.exports = router;
