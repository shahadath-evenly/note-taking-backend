const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const noteService = require('../services/note.service');

const listNotes = asyncHandler(async (req, res) => {
  const { notes, pagination } = await noteService.listNotes(req.user.userId, req.query);
  new ApiResponse(200, 'Records retrieved successfully', notes, pagination).send(res);
});

const createNote = asyncHandler(async (req, res) => {
  const note = await noteService.createNote(req.user.userId, req.body);
  new ApiResponse(201, 'Note created successfully', note).send(res);
});

const getNote = asyncHandler(async (req, res) => {
  const note = await noteService.getNote(req.user.userId, req.params.id);
  new ApiResponse(200, 'Note retrieved successfully', note).send(res);
});

const updateNote = asyncHandler(async (req, res) => {
  const note = await noteService.updateNote(req.user.userId, req.params.id, req.body);
  new ApiResponse(200, 'Note updated successfully', note).send(res);
});

const deleteNote = asyncHandler(async (req, res) => {
  await noteService.deleteNote(req.user.userId, req.params.id);
  new ApiResponse(200, 'Note deleted successfully', null).send(res);
});

module.exports = { listNotes, createNote, getNote, updateNote, deleteNote };
