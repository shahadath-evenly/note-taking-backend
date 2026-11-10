const yup = require('yup');
const { NOTE_SORT_FIELDS } = require('../../constants/sortFields');

const listNotesQuerySchema = yup.object({
  page: yup.number().integer().positive(),
  limit: yup.number().integer().positive().max(100),
  search: yup.string().trim().max(200),
  sortBy: yup.string().oneOf(NOTE_SORT_FIELDS, 'Invalid sortBy field'),
  sortOrder: yup.string().oneOf(['asc', 'desc'], 'Invalid sortOrder value'),
});

module.exports = listNotesQuerySchema;
