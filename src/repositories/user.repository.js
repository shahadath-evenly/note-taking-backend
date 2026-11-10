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
  return User.findByIdAndUpdate(id, data, { returnDocument: 'after', runValidators: true });
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

// Scenario 1 (interest grouping): this is the ONLY Mongoose call allowed in
// that request path. Pagination of the groups and the total group count are
// computed inside this same pipeline via $facet, so no separate count query
// is ever made. Users are de-duplicated per interest with $setUnion before
// unwinding, so a repeated interest value never produces duplicate entries
// within a group. Users with no interests are excluded via the $match on
// 'interests.0'. Only an explicit, safe field list is pushed per user, so a
// password hash can never reach the response even if the schema changes later.
function groupByInterests({ skip, limit }) {
  return User.aggregate([
    { $addFields: { interests: { $setUnion: ['$interests', []] } } },
    { $match: { 'interests.0': { $exists: true } } },
    { $unwind: '$interests' },
    {
      $group: {
        _id: '$interests',
        users: {
          $push: {
            _id: '$_id',
            firstName: '$firstName',
            lastName: '$lastName',
            email: '$email',
            role: '$role',
          },
        },
        userCount: { $sum: 1 },
      },
    },
    { $project: { _id: 0, interest: '$_id', users: 1, userCount: 1 } },
    { $sort: { interest: 1 } },
    {
      $facet: {
        data: [{ $skip: skip }, { $limit: limit }],
        totalCount: [{ $count: 'count' }],
      },
    },
  ]);
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
  groupByInterests,
};
