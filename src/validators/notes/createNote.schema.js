const yup = require('yup');

// No `userId` field: ownership is always derived from the authenticated
// request, never accepted from the client.
const createNoteSchema = yup.object({
  title: yup.string().trim().required('Title is required'),
  content: yup.string().trim().required('Content is required'),
});

module.exports = createNoteSchema;
