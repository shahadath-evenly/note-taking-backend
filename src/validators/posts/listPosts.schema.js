const yup = require('yup');
const { POST_SORT_FIELDS } = require('../../constants/sortFields');

const listPostsQuerySchema = yup.object({
  page: yup.number().integer().positive(),
  limit: yup.number().integer().positive().max(100),
  search: yup.string().trim().max(200),
  sortBy: yup.string().oneOf(POST_SORT_FIELDS, 'Invalid sortBy field'),
  sortOrder: yup.string().oneOf(['asc', 'desc'], 'Invalid sortOrder value'),
});

module.exports = listPostsQuerySchema;
