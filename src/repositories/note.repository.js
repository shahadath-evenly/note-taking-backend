const Note = require('../models/Note');

function findMany({ filter, sort, skip, limit }) {
  return Note.find(filter).sort(sort).skip(skip).limit(limit);
}

function count(filter) {
  return Note.countDocuments(filter);
}

// Admin global listing only: joins a safe owner summary (no password, since
// it is excluded from the populate projection and from the User schema's
// default serialization). Regular ownership-scoped queries never use this.
function findManyWithOwner({ filter, sort, skip, limit }) {
  return Note.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .populate('userId', 'firstName lastName email');
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

module.exports = {
  findMany,
  findManyWithOwner,
  count,
  findOneOwned,
  create,
  updateOneOwned,
  deleteOneOwned,
};
