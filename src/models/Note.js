const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

// Supports listing a single user's own notes, newest-first, with a stable
// `_id` tie-breaker for pagination. Owner-scoped reads/updates/deletes also
// filter by `_id` + `userId`, which this index's prefix covers.
noteSchema.index({ userId: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model('Note', noteSchema);
