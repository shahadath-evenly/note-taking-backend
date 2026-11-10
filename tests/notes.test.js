const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const app = require('../src/app');
const User = require('../src/models/User');
const Note = require('../src/models/Note');
const { signToken } = require('../src/utils/jwt');

const TEST_MONGO_URI =
  process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/secure_notes_test_notes';

let server;
let baseUrl;
let uniqueCounter = 0;

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
  // Index builds happen in the background after connect() resolves; without
  // this, a test could run before an index is actually active on a fresh database.
  await Promise.all([User.createIndexes(), Note.createIndexes()]);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Note.deleteMany({})]);
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

// --- Create ------------------------------------------------------------------

test('create: an authenticated user can create their own note', async () => {
  const user = await createUserDirect();
  const res = await request('/api/notes', {
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

  const res = await request('/api/notes', {
    method: 'POST',
    token: tokenFor(user),
    body: { title: 'Spoofed', content: 'Content', userId: someoneElse._id.toString() },
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.data.userId, user._id.toString());
});

test('create: rejects an unauthenticated request', async () => {
  const res = await request('/api/notes', {
    method: 'POST',
    body: { title: 'X', content: 'Y' },
  });
  assert.equal(res.status, 401);
});

test('create: rejects a request missing the title', async () => {
  const user = await createUserDirect();
  const res = await request('/api/notes', {
    method: 'POST',
    token: tokenFor(user),
    body: { content: 'No title here' },
  });
  assert.equal(res.status, 400);
});

test('create: content is optional — a title-only note is created with empty content', async () => {
  const user = await createUserDirect();
  const res = await request('/api/notes', {
    method: 'POST',
    token: tokenFor(user),
    body: { title: 'Only a title' },
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.data.title, 'Only a title');
  assert.equal(body.data.content, '');
});

test('create: rejects a title longer than 150 characters', async () => {
  const user = await createUserDirect();
  const res = await request('/api/notes', {
    method: 'POST',
    token: tokenFor(user),
    body: { title: 'a'.repeat(151), content: 'c' },
  });
  assert.equal(res.status, 400);
});

test('create: accepts a title exactly 150 characters long', async () => {
  const user = await createUserDirect();
  const res = await request('/api/notes', {
    method: 'POST',
    token: tokenFor(user),
    body: { title: 'a'.repeat(150), content: 'c' },
  });
  assert.equal(res.status, 201);
});

// --- List --------------------------------------------------------------------

test('list: returns only the authenticated user\'s own notes', async () => {
  const userA = await createUserDirect();
  const userB = await createUserDirect();
  await Note.create({ title: 'A1', content: 'content', userId: userA._id });
  await Note.create({ title: 'B1', content: 'content', userId: userB._id });

  const res = await request('/api/notes', { token: tokenFor(userA) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].title, 'A1');
});

test('list: rejects an unauthenticated request', async () => {
  const res = await request('/api/notes');
  assert.equal(res.status, 401);
});

test('pagination: respects page/limit and computes correct metadata', async () => {
  const user = await createUserDirect();
  await Promise.all(
    Array.from({ length: 14 }, (_, i) => Note.create({ title: `Note ${i}`, content: 'c', userId: user._id }))
  );

  const res = await request('/api/notes?page=2&limit=5', { token: tokenFor(user) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.length, 5);
  assert.deepEqual(body.pagination, { page: 2, limit: 5, total: 14, totalPages: 3 });
});

test('pagination: a page beyond the last page returns an empty array with correct metadata', async () => {
  const user = await createUserDirect();
  await Note.create({ title: 'Only one', content: 'c', userId: user._id });

  const res = await request('/api/notes?page=99&limit=10', { token: tokenFor(user) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body.data, []);
  assert.equal(body.pagination.total, 1);
});

test('pagination: rejects a limit above the maximum', async () => {
  const user = await createUserDirect();
  const res = await request('/api/notes?limit=500', { token: tokenFor(user) });
  assert.equal(res.status, 400);
});

test('search: matches title or content, scoped to the caller\'s own notes', async () => {
  const user = await createUserDirect();
  const otherUser = await createUserDirect();
  await Note.create({ title: 'Grocery list', content: 'milk, eggs', userId: user._id });
  await Note.create({ title: 'Work plan', content: 'quarterly review', userId: user._id });
  await Note.create({ title: 'Grocery list', content: 'bread', userId: otherUser._id });

  const res = await request('/api/notes?search=grocery', { token: tokenFor(user) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].content, 'milk, eggs');
});

test('sorting: an allow-listed field sorts correctly', async () => {
  const user = await createUserDirect();
  await Note.create({ title: 'Charlie', content: 'c', userId: user._id });
  await Note.create({ title: 'Alice', content: 'c', userId: user._id });
  await Note.create({ title: 'Bob', content: 'c', userId: user._id });

  const res = await request('/api/notes?sortBy=title&sortOrder=asc&limit=100', { token: tokenFor(user) });
  const body = await res.json();
  const titles = body.data.map((n) => n.title);

  assert.deepEqual([...titles].sort(), titles);
});

test('sorting: rejects a non-allow-listed sort field', async () => {
  const user = await createUserDirect();
  const res = await request('/api/notes?sortBy=userId', { token: tokenFor(user) });
  assert.equal(res.status, 400);
});

// --- Get one -------------------------------------------------------------------

test('get: an owner can retrieve their own note', async () => {
  const user = await createUserDirect();
  const note = await Note.create({ title: 'Mine', content: 'c', userId: user._id });

  const res = await request(`/api/notes/${note._id}`, { token: tokenFor(user) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.title, 'Mine');
});

test('get: User A cannot read User B\'s note by guessing its ID', async () => {
  const userA = await createUserDirect();
  const userB = await createUserDirect();
  const bNote = await Note.create({ title: 'Secret', content: 'c', userId: userB._id });

  const res = await request(`/api/notes/${bNote._id}`, { token: tokenFor(userA) });
  assert.equal(res.status, 404);
});

test('get: returns 404 for a well-formed but non-existent id', async () => {
  const user = await createUserDirect();
  const fakeId = new mongoose.Types.ObjectId();

  const res = await request(`/api/notes/${fakeId}`, { token: tokenFor(user) });
  assert.equal(res.status, 404);
});

test('get: returns 400 for a malformed id', async () => {
  const user = await createUserDirect();
  const res = await request('/api/notes/not-a-valid-id', { token: tokenFor(user) });
  assert.equal(res.status, 400);
});

// --- Update ----------------------------------------------------------------------

test('update: an owner can update their own note', async () => {
  const user = await createUserDirect();
  const note = await Note.create({ title: 'Before', content: 'c', userId: user._id });

  const res = await request(`/api/notes/${note._id}`, {
    method: 'PATCH',
    token: tokenFor(user),
    body: { title: 'After' },
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.title, 'After');
});

test('update: User A cannot update User B\'s note', async () => {
  const userA = await createUserDirect();
  const userB = await createUserDirect();
  const bNote = await Note.create({ title: 'Original', content: 'c', userId: userB._id });

  const res = await request(`/api/notes/${bNote._id}`, {
    method: 'PATCH',
    token: tokenFor(userA),
    body: { title: 'Hacked' },
  });
  assert.equal(res.status, 404);

  const stillOriginal = await Note.findById(bNote._id);
  assert.equal(stillOriginal.title, 'Original');
});

test('update: rejects an empty update body', async () => {
  const user = await createUserDirect();
  const note = await Note.create({ title: 'Title', content: 'c', userId: user._id });

  const res = await request(`/api/notes/${note._id}`, {
    method: 'PATCH',
    token: tokenFor(user),
    body: {},
  });
  assert.equal(res.status, 400);
});

test('update: content can be cleared to an empty string', async () => {
  const user = await createUserDirect();
  const note = await Note.create({ title: 'Title', content: 'Some content', userId: user._id });

  const res = await request(`/api/notes/${note._id}`, {
    method: 'PATCH',
    token: tokenFor(user),
    body: { content: '' },
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.content, '');
});

test('update: rejects clearing the title to an empty string', async () => {
  const user = await createUserDirect();
  const note = await Note.create({ title: 'Title', content: 'c', userId: user._id });

  const res = await request(`/api/notes/${note._id}`, {
    method: 'PATCH',
    token: tokenFor(user),
    body: { title: '' },
  });
  assert.equal(res.status, 400);
});

test('update: rejects a title longer than 150 characters', async () => {
  const user = await createUserDirect();
  const note = await Note.create({ title: 'Title', content: 'c', userId: user._id });

  const res = await request(`/api/notes/${note._id}`, {
    method: 'PATCH',
    token: tokenFor(user),
    body: { title: 'a'.repeat(151) },
  });
  assert.equal(res.status, 400);
});

// --- Delete ------------------------------------------------------------------------

test('delete: an owner can delete their own note', async () => {
  const user = await createUserDirect();
  const note = await Note.create({ title: 'To delete', content: 'c', userId: user._id });

  const res = await request(`/api/notes/${note._id}`, { method: 'DELETE', token: tokenFor(user) });
  assert.equal(res.status, 200);

  const stillThere = await Note.findById(note._id);
  assert.equal(stillThere, null);
});

test('delete: User A cannot delete User B\'s note', async () => {
  const userA = await createUserDirect();
  const userB = await createUserDirect();
  const bNote = await Note.create({ title: 'Protected', content: 'c', userId: userB._id });

  const res = await request(`/api/notes/${bNote._id}`, { method: 'DELETE', token: tokenFor(userA) });
  assert.equal(res.status, 404);

  const stillThere = await Note.findById(bNote._id);
  assert.ok(stillThere);
});

test('delete: returns 404 for a non-existent id', async () => {
  const user = await createUserDirect();
  const fakeId = new mongoose.Types.ObjectId();

  const res = await request(`/api/notes/${fakeId}`, { method: 'DELETE', token: tokenFor(user) });
  assert.equal(res.status, 404);
});
