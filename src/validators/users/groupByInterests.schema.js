const yup = require('yup');

const groupByInterestsQuerySchema = yup.object({
  page: yup.number().integer().positive(),
  limit: yup.number().integer().positive().max(100),
});

module.exports = groupByInterestsQuerySchema;
