const User = require('../models/User');

function buildFilter({ role, searchFilter } = {}) {
  const filter = {};
  if (role) {
    filter.role = role;
  }
  if (searchFilter) {
    Object.assign(filter, searchFilter);
  }
  return filter;
}

function findMany({ filter, sort, skip, limit }) {
  return User.find(filter).sort(sort).skip(skip).limit(limit);
}

function count(filter) {
  return User.countDocuments(filter);
}

function findById(id) {
  return User.findById(id);
}

function create(data) {
  return User.create(data);
}

function updateById(id, data) {
  return User.findByIdAndUpdate(id, data, { new: true, runValidators: true });
}

function deleteById(id) {
  return User.findByIdAndDelete(id);
}

function countAdmins(excludeId) {
  const filter = { role: 'admin' };
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }
  return User.countDocuments(filter);
}

module.exports = {
  buildFilter,
  findMany,
  count,
  findById,
  create,
  updateById,
  deleteById,
  countAdmins,
};
