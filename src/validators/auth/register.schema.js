const yup = require('yup');

// No `role` field: combined with validateRequest's stripUnknown, this prevents
// a client from ever assigning itself admin through registration.
const registerSchema = yup.object({
  firstName: yup.string().trim().required('First name is required'),
  lastName: yup.string().trim().required('Last name is required'),
  email: yup.string().trim().lowercase().email('Invalid email address').required('Email is required'),
  password: yup.string().min(8, 'Password must be at least 8 characters').required('Password is required'),
});

module.exports = registerSchema;
