const express = require('express');
const authenticate = require('../middlewares/authenticate');
const validateRequest = require('../middlewares/validateRequest');
const createNoteSchema = require('../validators/notes/createNote.schema');
const updateNoteSchema = require('../validators/notes/updateNote.schema');
const listNotesQuerySchema = require('../validators/notes/listNotes.schema');
const {
  listNotes,
  createNote,
  getNote,
  updateNote,
  deleteNote,
} = require('../controllers/notes.controller');

const router = express.Router();

router.use(authenticate);

router.get('/', validateRequest(listNotesQuerySchema, 'query'), listNotes);
router.post('/', validateRequest(createNoteSchema), createNote);
router.get('/:id', getNote);
router.patch('/:id', validateRequest(updateNoteSchema), updateNote);
router.delete('/:id', deleteNote);

module.exports = router;
