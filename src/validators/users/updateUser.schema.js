const yup = require('yup');
const { ROLE_VALUES } = require('../../constants/roles');

const updateUserSchema = yup
  .object({
    firstName: yup.string().trim(),
    lastName: yup.string().trim(),
    email: yup.string().trim().lowercase().email('Invalid email address'),
    role: yup.string().oneOf(ROLE_VALUES, 'Invalid role'),
    interests: yup.array().of(yup.string().trim()),
  })
  .test('at-least-one-field', 'At least one field must be provided', (value) => Boolean(value) && Object.keys(value).length > 0);

module.exports = updateUserSchema;
