const yup = require('yup');

const updateNoteSchema = yup
  .object({
    title: yup.string().trim().min(1, 'Title cannot be empty').max(150, 'Title must be at most 150 characters'),
    content: yup.string().trim(),
  })
  .test('at-least-one-field', 'At least one field must be provided', (value) => Boolean(value) && Object.keys(value).length > 0);

module.exports = updateNoteSchema;
