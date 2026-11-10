const yup = require('yup');

// No `userId` field: ownership is always derived from the authenticated
// request, never accepted from the client. Content is intentionally
// optional (defaults to an empty string) — a note can be created with just
// a title, matching a plain-notes-app ("type a title to save") workflow.
const createNoteSchema = yup.object({
  title: yup.string().trim().max(150, 'Title must be at most 150 characters').required('Title is required'),
  content: yup.string().trim().default(''),
});

module.exports = createNoteSchema;
