const yup = require('yup');
const { ROLE_VALUES } = require('../../constants/roles');
const { USER_SORT_FIELDS } = require('../../constants/sortFields');

const listUsersQuerySchema = yup.object({
  page: yup.number().integer().positive(),
  limit: yup.number().integer().positive().max(100),
  search: yup.string().trim().max(200),
  role: yup.string().oneOf(ROLE_VALUES, 'Invalid role filter'),
  sortBy: yup.string().oneOf(USER_SORT_FIELDS, 'Invalid sortBy field'),
  sortOrder: yup.string().oneOf(['asc', 'desc'], 'Invalid sortOrder value'),
});

module.exports = listUsersQuerySchema;
