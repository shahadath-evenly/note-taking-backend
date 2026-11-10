const yup = require('yup');

const loginSchema = yup.object({
  email: yup.string().trim().lowercase().email('Invalid email address').required('Email is required'),
  password: yup.string().required('Password is required'),
});

module.exports = loginSchema;
