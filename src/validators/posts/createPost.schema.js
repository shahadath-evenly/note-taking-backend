const yup = require('yup');

const createPostSchema = yup.object({
  title: yup.string().trim().required('Title is required'),
  content: yup.string().trim().required('Content is required'),
});

module.exports = createPostSchema;
