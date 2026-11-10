const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function toPositiveInteger(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function parsePagination(query = {}) {
  const page = toPositiveInteger(query.page) || DEFAULT_PAGE;
  const requestedLimit = toPositiveInteger(query.limit) || DEFAULT_LIMIT;
  const limit = Math.min(requestedLimit, MAX_LIMIT);

  return { page, limit, skip: (page - 1) * limit };
}

function parseSort(query = {}, allowedFields = [], defaultSort = { createdAt: -1, _id: -1 }) {
  const { sortBy, sortOrder } = query;

  if (!sortBy || !allowedFields.includes(sortBy)) {
    return defaultSort;
  }

  const direction = sortOrder === 'asc' ? 1 : -1;
  return { [sortBy]: direction, _id: direction };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSearchFilter(searchTerm, searchableFields = []) {
  if (!searchTerm || typeof searchTerm !== 'string' || searchableFields.length === 0) {
    return null;
  }

  const trimmed = searchTerm.trim();
  if (!trimmed) {
    return null;
  }

  const regex = new RegExp(escapeRegex(trimmed), 'i');
  return { $or: searchableFields.map((field) => ({ [field]: regex })) };
}

function buildPaginationMeta({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

function buildListQuery(query = {}, { allowedSortFields = [], defaultSort, searchableFields = [] } = {}) {
  const { page, limit, skip } = parsePagination(query);
  const sort = parseSort(query, allowedSortFields, defaultSort);
  const searchFilter = buildSearchFilter(query.search, searchableFields);

  return { page, limit, skip, sort, searchFilter };
}

module.exports = {
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parsePagination,
  parseSort,
  escapeRegex,
  buildSearchFilter,
  buildPaginationMeta,
  buildListQuery,
};
