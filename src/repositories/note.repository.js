const Note = require('../models/Note');

function findMany({ filter, sort, skip, limit }) {
  return Note.find(filter).sort(sort).skip(skip).limit(limit);
}

function count(filter) {
  return Note.countDocuments(filter);
}

// All single-document operations filter by `_id` AND `userId` together, so a
// non-owner's request for another user's note behaves exactly like the note
// not existing, instead of leaking its existence via a separate ownership check.
function findOneOwned(id, userId) {
  return Note.findOne({ _id: id, userId });
}

function create(data) {
  return Note.create(data);
}

function updateOneOwned(id, userId, data) {
  return Note.findOneAndUpdate(
    { _id: id, userId },
    data,
    { returnDocument: 'after', runValidators: true }
  );
}

function deleteOneOwned(id, userId) {
  return Note.findOneAndDelete({ _id: id, userId });
}

module.exports = { findMany, count, findOneOwned, create, updateOneOwned, deleteOneOwned };
