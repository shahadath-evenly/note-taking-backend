const yup = require('yup');
const { ROLE_VALUES } = require('../../constants/roles');

const createUserSchema = yup.object({
  firstName: yup.string().trim().required('First name is required'),
  lastName: yup.string().trim().required('Last name is required'),
  email: yup.string().trim().lowercase().email('Invalid email address').required('Email is required'),
  password: yup.string().min(8, 'Password must be at least 8 characters').required('Password is required'),
  role: yup.string().oneOf(ROLE_VALUES, 'Invalid role').default('user'),
  interests: yup.array().of(yup.string().trim()).default([]),
});

module.exports = createUserSchema;
