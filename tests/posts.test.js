const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const app = require('../src/app');
const User = require('../src/models/User');
const Post = require('../src/models/Post');
const { signToken } = require('../src/utils/jwt');

const TEST_MONGO_URI =
  process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/secure_notes_test_posts';

let server;
let baseUrl;
let uniqueCounter = 0;

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
  // Index builds happen in the background after connect() resolves; without
  // this, a test could run before an index is actually active on a fresh database.
  await Promise.all([User.createIndexes(), Post.createIndexes()]);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Post.deleteMany({})]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

function uniqueEmail(label) {
  uniqueCounter += 1;
  return `${label}.${uniqueCounter}@example.com`;
}

function createUserDirect(overrides = {}) {
  return User.create({
    firstName: 'First',
    lastName: 'Last',
    email: uniqueEmail('user'),
    password: 'Sup3rSecret!',
    ...overrides,
  });
}

function tokenFor(user) {
  return signToken({ userId: user._id.toString(), role: user.role });
}

function request(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// --- Public listing ----------------------------------------------------------

test('list: is publicly accessible without a token', async () => {
  const user = await createUserDirect();
  await Post.create({ title: 'Public post', content: 'c', userId: user._id });

  const res = await request('/api/posts');
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.length, 1);
  assert.ok(body.pagination);
});

test('list: defaults to newest-first', async () => {
  const user = await createUserDirect();
  const first = await Post.create({ title: 'First', content: 'c', userId: user._id });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await Post.create({ title: 'Second', content: 'c', userId: user._id });

  const res = await request('/api/posts');
  const body = await res.json();

  assert.equal(body.data[0]._id, second._id.toString());
  assert.equal(body.data[1]._id, first._id.toString());
});

// --- Pagination ----------------------------------------------------------------

test('pagination: respects page/limit and computes correct metadata', async () => {
  const user = await createUserDirect();
  await Promise.all(
    Array.from({ length: 14 }, (_, i) => Post.create({ title: `Post ${i}`, content: 'c', userId: user._id }))
  );

  const res = await request('/api/posts?page=2&limit=5');
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.length, 5);
  assert.deepEqual(body.pagination, { page: 2, limit: 5, total: 14, totalPages: 3 });
});

test('pagination: a page beyond the last page returns an empty array with correct metadata', async () => {
  const user = await createUserDirect();
  await Post.create({ title: 'Only one', content: 'c', userId: user._id });

  const res = await request('/api/posts?page=99&limit=10');
  const body = await res.json();

  assert.deepEqual(body.data, []);
  assert.equal(body.pagination.total, 1);
});

test('pagination: rejects a limit above the maximum', async () => {
  const res = await request('/api/posts?limit=500');
  assert.equal(res.status, 400);
});

// --- Search ----------------------------------------------------------------------

test('search: matches title or content across all authors', async () => {
  const userA = await createUserDirect();
  const userB = await createUserDirect();
  await Post.create({ title: 'Grocery list', content: 'milk, eggs', userId: userA._id });
  await Post.create({ title: 'Work plan', content: 'quarterly review', userId: userB._id });

  const res = await request('/api/posts?search=grocery');
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].title, 'Grocery list');
});

// --- Sorting ----------------------------------------------------------------------

test('sorting: an allow-listed field sorts correctly', async () => {
  const user = await createUserDirect();
  await Post.create({ title: 'Charlie', content: 'c', userId: user._id });
  await Post.create({ title: 'Alice', content: 'c', userId: user._id });
  await Post.create({ title: 'Bob', content: 'c', userId: user._id });

  const res = await request('/api/posts?sortBy=title&sortOrder=asc&limit=100');
  const body = await res.json();
  const titles = body.data.map((p) => p.title);

  assert.deepEqual([...titles].sort(), titles);
});

test('sorting: rejects a non-allow-listed sort field', async () => {
  const res = await request('/api/posts?sortBy=userId');
  assert.equal(res.status, 400);
});

// --- Creation ----------------------------------------------------------------------

test('create: an authenticated user can create a post', async () => {
  const user = await createUserDirect();
  const res = await request('/api/posts', {
    method: 'POST',
    token: tokenFor(user),
    body: { title: 'My title', content: 'My content' },
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.data.title, 'My title');
  assert.equal(body.data.userId, user._id.toString());
});

test('create: userId is always derived from the token, never from the client', async () => {
  const user = await createUserDirect();
  const someoneElse = await createUserDirect();

  const res = await request('/api/posts', {
    method: 'POST',
    token: tokenFor(user),
    body: { title: 'Spoofed', content: 'Content', userId: someoneElse._id.toString() },
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.data.userId, user._id.toString());
});

test('create: rejects an unauthenticated request', async () => {
  const res = await request('/api/posts', {
    method: 'POST',
    body: { title: 'X', content: 'Y' },
  });
  assert.equal(res.status, 401);
});

test('create: rejects a request missing required fields', async () => {
  const user = await createUserDirect();
  const res = await request('/api/posts', {
    method: 'POST',
    token: tokenFor(user),
    body: { title: 'Only a title' },
  });
  assert.equal(res.status, 400);
});

test('create: rejects a title longer than 150 characters', async () => {
  const user = await createUserDirect();
  const res = await request('/api/posts', {
    method: 'POST',
    token: tokenFor(user),
    body: { title: 'a'.repeat(151), content: 'c' },
  });
  assert.equal(res.status, 400);
});

test('create: accepts a title exactly 150 characters long', async () => {
  const user = await createUserDirect();
  const res = await request('/api/posts', {
    method: 'POST',
    token: tokenFor(user),
    body: { title: 'a'.repeat(150), content: 'c' },
  });
  assert.equal(res.status, 201);
});

// --- Response safety -----------------------------------------------------------------

test('safety: no post response ever includes a password field', async () => {
  const user = await createUserDirect();
  const createRes = await request('/api/posts', {
    method: 'POST',
    token: tokenFor(user),
    body: { title: 'Title', content: 'Content' },
  });
  const createBody = await createRes.json();
  assert.equal(Object.prototype.hasOwnProperty.call(createBody.data, 'password'), false);

  const listRes = await request('/api/posts');
  const listBody = await listRes.json();
  for (const post of listBody.data) {
    assert.equal(Object.prototype.hasOwnProperty.call(post, 'password'), false);
  }
});

// --- Restrictions respected ------------------------------------------------------------

test('restrictions: no PATCH/DELETE endpoints exist for posts', async () => {
  const user = await createUserDirect();
  const post = await Post.create({ title: 'Title', content: 'c', userId: user._id });

  const patchRes = await request(`/api/posts/${post._id}`, { method: 'PATCH', token: tokenFor(user), body: {} });
  assert.equal(patchRes.status, 404);

  const deleteRes = await request(`/api/posts/${post._id}`, { method: 'DELETE', token: tokenFor(user) });
  assert.equal(deleteRes.status, 404);
});
