const ApiError = require('../utils/ApiError');
const userRepository = require('../repositories/user.repository');
const { buildListQuery, buildPaginationMeta } = require('../utils/pagination');
const { USER_SORT_FIELDS } = require('../constants/sortFields');
const { ROLES } = require('../constants/roles');

const SEARCHABLE_FIELDS = ['firstName', 'lastName', 'email'];
const DEFAULT_SORT = { createdAt: -1, _id: -1 };

async function listUsers(query) {
  const { page, limit, skip, sort, searchFilter } = buildListQuery(query, {
    allowedSortFields: USER_SORT_FIELDS,
    defaultSort: DEFAULT_SORT,
    searchableFields: SEARCHABLE_FIELDS,
  });

  const filter = userRepository.buildFilter({ role: query.role, searchFilter });

  const [docs, total] = await Promise.all([
    userRepository.findMany({ filter, sort, skip, limit }),
    userRepository.count(filter),
  ]);

  return {
    users: docs.map((doc) => doc.toJSON()),
    pagination: buildPaginationMeta({ page, limit, total }),
  };
}

async function createUser(data) {
  const user = await userRepository.create(data);
  return user.toJSON();
}

async function getUserById(id) {
  const user = await userRepository.findById(id);
  if (!user) {
    throw ApiError.notFound('User not found');
  }
  return user.toJSON();
}

async function updateUser(id, data) {
  const target = await userRepository.findById(id);
  if (!target) {
    throw ApiError.notFound('User not found');
  }

  const isDemotingFromAdmin = target.role === ROLES.ADMIN && data.role && data.role !== ROLES.ADMIN;

  if (isDemotingFromAdmin) {
    const remainingAdmins = await userRepository.countAdmins(target._id);
    if (remainingAdmins === 0) {
      throw ApiError.conflict('Cannot demote the last remaining admin');
    }
  }

  const updated = await userRepository.updateById(id, data);
  return updated.toJSON();
}

async function deleteUser(id, requestingAdminId) {
  if (id === requestingAdminId) {
    throw ApiError.forbidden('Admins cannot delete their own account');
  }

  const target = await userRepository.findById(id);
  if (!target) {
    throw ApiError.notFound('User not found');
  }

  if (target.role === ROLES.ADMIN) {
    const remainingAdmins = await userRepository.countAdmins(target._id);
    if (remainingAdmins === 0) {
      throw ApiError.conflict('Cannot delete the last remaining admin');
    }
  }

  await userRepository.deleteById(id);
}

module.exports = { listUsers, createUser, getUserById, updateUser, deleteUser };
