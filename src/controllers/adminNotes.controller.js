const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const adminNoteService = require('../services/adminNote.service');

const listAllNotes = asyncHandler(async (req, res) => {
  const { notes, pagination } = await adminNoteService.listAllNotes(req.query);
  new ApiResponse(200, 'Records retrieved successfully', notes, pagination).send(res);
});

module.exports = { listAllNotes };
