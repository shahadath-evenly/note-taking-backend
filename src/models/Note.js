const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: [150, 'Title must be at most 150 characters'],
    },
    content: {
      type: String,
      default: '',
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

// Supports the admin global notes listing's default newest-first sort (no
// `userId` filter, so the index above cannot serve it — its leading key is
// `userId`). Added after confirming with explain("executionStats") that
// without this index the same query does a full COLLSCAN + in-memory SORT
// over every note; see docs/INDEX_STRATEGY.md for the before/after evidence.
noteSchema.index({ createdAt: -1, _id: -1 });

module.exports = mongoose.model('Note', noteSchema);
