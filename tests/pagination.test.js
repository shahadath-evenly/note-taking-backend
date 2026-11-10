const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parsePagination,
  parseSort,
  escapeRegex,
  buildSearchFilter,
  buildPaginationMeta,
  buildListQuery,
} = require('../src/utils/pagination');

test('parsePagination: defaults when page/limit are absent', () => {
  const result = parsePagination({});
  assert.deepEqual(result, { page: DEFAULT_PAGE, limit: DEFAULT_LIMIT, skip: 0 });
});

test('parsePagination: parses valid positive integers from query strings', () => {
  const result = parsePagination({ page: '3', limit: '20' });
  assert.deepEqual(result, { page: 3, limit: 20, skip: 40 });
});

test('parsePagination: falls back to defaults for invalid page values', () => {
  for (const page of ['0', '-1', 'abc', '1.5', '']) {
    const result = parsePagination({ page });
    assert.equal(result.page, DEFAULT_PAGE, `page=${page} should fall back to default`);
  }
});

test('parsePagination: falls back to defaults for invalid limit values', () => {
  for (const limit of ['0', '-5', 'abc', '2.5', '']) {
    const result = parsePagination({ limit });
    assert.equal(result.limit, DEFAULT_LIMIT, `limit=${limit} should fall back to default`);
  }
});

test('parsePagination: caps limit at MAX_LIMIT', () => {
  const result = parsePagination({ limit: '500' });
  assert.equal(result.limit, MAX_LIMIT);
});

test('parsePagination: accepts limit exactly at MAX_LIMIT', () => {
  const result = parsePagination({ limit: String(MAX_LIMIT) });
  assert.equal(result.limit, MAX_LIMIT);
});

test('parseSort: uses the default sort when sortBy is missing', () => {
  const defaultSort = { createdAt: -1, _id: -1 };
  const result = parseSort({}, ['title'], defaultSort);
  assert.deepEqual(result, defaultSort);
});

test('parseSort: uses the default sort when sortBy is not allow-listed', () => {
  const defaultSort = { createdAt: -1, _id: -1 };
  const result = parseSort({ sortBy: 'password' }, ['title', 'createdAt'], defaultSort);
  assert.deepEqual(result, defaultSort, 'a non-allow-listed field must never reach the sort object');
});

test('parseSort: applies an allow-listed field ascending', () => {
  const result = parseSort({ sortBy: 'title', sortOrder: 'asc' }, ['title'], { createdAt: -1 });
  assert.deepEqual(result, { title: 1, _id: 1 });
});

test('parseSort: applies an allow-listed field descending by default', () => {
  const result = parseSort({ sortBy: 'title' }, ['title'], { createdAt: -1 });
  assert.deepEqual(result, { title: -1, _id: -1 });
});

test('parseSort: an invalid sortOrder value defaults to descending', () => {
  const result = parseSort({ sortBy: 'title', sortOrder: 'sideways' }, ['title'], { createdAt: -1 });
  assert.deepEqual(result, { title: -1, _id: -1 });
});

test('escapeRegex: escapes special regex characters', () => {
  assert.equal(escapeRegex('a.b*c?'), 'a\\.b\\*c\\?');
  assert.equal(escapeRegex('(parens)'), '\\(parens\\)');
});

test('buildSearchFilter: returns null when search term is empty or whitespace', () => {
  assert.equal(buildSearchFilter('', ['title']), null);
  assert.equal(buildSearchFilter('   ', ['title']), null);
  assert.equal(buildSearchFilter(undefined, ['title']), null);
});

test('buildSearchFilter: returns null when no searchable fields are configured', () => {
  assert.equal(buildSearchFilter('hello', []), null);
});

test('buildSearchFilter: builds a case-insensitive $or filter across fields', () => {
  const filter = buildSearchFilter('hello', ['title', 'content']);
  assert.ok(filter.$or);
  assert.equal(filter.$or.length, 2);
  assert.equal(filter.$or[0].title.source, 'hello');
  assert.equal(filter.$or[0].title.flags, 'i');
});

test('buildSearchFilter: treats regex special characters as literal text', () => {
  const filter = buildSearchFilter('a.b(c)', ['title']);
  const regex = filter.$or[0].title;
  assert.equal(regex.test('a.b(c)'), true);
  assert.equal(regex.test('axbxcx'), false, 'the dot must not act as a wildcard');
});

test('buildPaginationMeta: computes totalPages correctly, including remainders and zero total', () => {
  assert.deepEqual(buildPaginationMeta({ page: 1, limit: 10, total: 42 }), {
    page: 1,
    limit: 10,
    total: 42,
    totalPages: 5,
  });
  assert.deepEqual(buildPaginationMeta({ page: 1, limit: 10, total: 0 }), {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });
  assert.deepEqual(buildPaginationMeta({ page: 1, limit: 10, total: 20 }).totalPages, 2);
});

test('buildListQuery: combines pagination, allow-listed sort, and search filter', () => {
  const result = buildListQuery(
    { page: '2', limit: '5', sortBy: 'title', sortOrder: 'asc', search: 'note' },
    { allowedSortFields: ['title'], defaultSort: { createdAt: -1 }, searchableFields: ['title', 'content'] }
  );

  assert.equal(result.page, 2);
  assert.equal(result.limit, 5);
  assert.equal(result.skip, 5);
  assert.deepEqual(result.sort, { title: 1, _id: 1 });
  assert.ok(result.searchFilter.$or);
});

test('buildListQuery: ignores a client-provided sort field that is not allow-listed', () => {
  const result = buildListQuery(
    { sortBy: '$where' },
    { allowedSortFields: ['title'], defaultSort: { createdAt: -1, _id: -1 } }
  );

  assert.deepEqual(result.sort, { createdAt: -1, _id: -1 });
});
