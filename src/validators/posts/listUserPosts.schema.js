const yup = require('yup');

const listUserPostsQuerySchema = yup.object({
  page: yup.number().integer().positive(),
  limit: yup.number().integer().positive().max(100),
});

module.exports = listUserPostsQuerySchema;
