const mongoose = require('mongoose');

const postSchema = new mongoose.Schema(
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

// Supports the user-posts `$lookup` aggregation's per-user match and
// newest-first order. No standalone `userId` index is declared since this
// compound index already starts with `userId`.
postSchema.index({ userId: 1, createdAt: -1, _id: -1 });

// Supports the public posts listing, which is required to be newest-first.
postSchema.index({ createdAt: -1, _id: -1 });

module.exports = mongoose.model('Post', postSchema);
