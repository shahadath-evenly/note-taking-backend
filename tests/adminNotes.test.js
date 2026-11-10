const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const app = require('../src/app');
const User = require('../src/models/User');
const Note = require('../src/models/Note');
const { signToken } = require('../src/utils/jwt');
const { ROLES } = require('../src/constants/roles');

const TEST_MONGO_URI =
  process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/secure_notes_test_admin_notes';

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
    role: ROLES.USER,
    ...overrides,
  });
}

function createAdminDirect(overrides = {}) {
  return createUserDirect({ role: ROLES.ADMIN, ...overrides });
}

function tokenFor(user) {
  return signToken({ userId: user._id.toString(), role: user.role });
}

function request(path, { token } = {}) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return fetch(`${baseUrl}${path}`, { headers });
}

// --- Authorization -----------------------------------------------------------

test('authorization: rejects requests with no token', async () => {
  const res = await request('/api/admin/notes');
  assert.equal(res.status, 401);
});

test('authorization: rejects a normal user with 403', async () => {
  const normalUser = await createUserDirect();
  const res = await request('/api/admin/notes', { token: tokenFor(normalUser) });
  assert.equal(res.status, 403);
});

test('authorization: allows an admin to list every user\'s notes', async () => {
  const admin = await createAdminDirect();
  const userA = await createUserDirect();
  const userB = await createUserDirect();
  await Note.create({ title: 'A note', content: 'c', userId: userA._id });
  await Note.create({ title: 'B note', content: 'c', userId: userB._id });

  const res = await request('/api/admin/notes', { token: tokenFor(admin) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.length, 2);
  assert.ok(body.pagination);
});

// --- Pagination ----------------------------------------------------------------

test('pagination: respects page/limit and computes correct metadata', async () => {
  const admin = await createAdminDirect();
  const owner = await createUserDirect();
  await Promise.all(
    Array.from({ length: 14 }, (_, i) => Note.create({ title: `Note ${i}`, content: 'c', userId: owner._id }))
  );

  const res = await request('/api/admin/notes?page=2&limit=5', { token: tokenFor(admin) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.length, 5);
  assert.deepEqual(body.pagination, { page: 2, limit: 5, total: 14, totalPages: 3 });
});

test('pagination: a page beyond the last page returns an empty array with correct metadata', async () => {
  const admin = await createAdminDirect();
  const owner = await createUserDirect();
  await Note.create({ title: 'Only one', content: 'c', userId: owner._id });

  const res = await request('/api/admin/notes?page=99&limit=10', { token: tokenFor(admin) });
  const body = await res.json();

  assert.deepEqual(body.data, []);
  assert.equal(body.pagination.total, 1);
});

test('pagination: rejects a limit above the maximum', async () => {
  const admin = await createAdminDirect();
  const res = await request('/api/admin/notes?limit=500', { token: tokenFor(admin) });
  assert.equal(res.status, 400);
});

// --- Search ----------------------------------------------------------------------

test('search: matches note title or content across all owners', async () => {
  const admin = await createAdminDirect();
  const userA = await createUserDirect();
  const userB = await createUserDirect();
  await Note.create({ title: 'Grocery list', content: 'milk, eggs', userId: userA._id });
  await Note.create({ title: 'Work plan', content: 'quarterly review', userId: userB._id });

  const res = await request('/api/admin/notes?search=grocery', { token: tokenFor(admin) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].title, 'Grocery list');
});

// --- Sorting ----------------------------------------------------------------------

test('sorting: an allow-listed field sorts correctly', async () => {
  const admin = await createAdminDirect();
  const owner = await createUserDirect();
  await Note.create({ title: 'Charlie', content: 'c', userId: owner._id });
  await Note.create({ title: 'Alice', content: 'c', userId: owner._id });
  await Note.create({ title: 'Bob', content: 'c', userId: owner._id });

  const res = await request('/api/admin/notes?sortBy=title&sortOrder=asc&limit=100', { token: tokenFor(admin) });
  const body = await res.json();
  const titles = body.data.map((n) => n.title);

  assert.deepEqual([...titles].sort(), titles);
});

test('sorting: rejects a non-allow-listed sort field', async () => {
  const admin = await createAdminDirect();
  const res = await request('/api/admin/notes?sortBy=userId', { token: tokenFor(admin) });
  assert.equal(res.status, 400);
});

// --- Response safety -----------------------------------------------------------------

test('safety: includes a safe owner summary, never a password, and keeps userId a plain id', async () => {
  const admin = await createAdminDirect();
  const owner = await createUserDirect({ firstName: 'Owner', lastName: 'Person' });
  await Note.create({ title: 'Note', content: 'c', userId: owner._id });

  const res = await request('/api/admin/notes', { token: tokenFor(admin) });
  const body = await res.json();
  const [note] = body.data;

  assert.equal(note.userId, owner._id.toString());
  assert.equal(note.owner.firstName, 'Owner');
  assert.equal(note.owner.email, owner.email);
  assert.equal(Object.prototype.hasOwnProperty.call(note.owner, 'password'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(note, 'password'), false);
});

test('safety: notes from users with no remaining owner reference still omit a password field', async () => {
  const admin = await createAdminDirect();
  const owner = await createUserDirect();
  const note = await Note.create({ title: 'Orphan', content: 'c', userId: owner._id });
  await User.deleteOne({ _id: owner._id });

  const res = await request('/api/admin/notes', { token: tokenFor(admin) });
  const body = await res.json();
  const found = body.data.find((n) => n._id === note._id.toString());

  assert.ok(found);
  assert.equal(found.owner, null);
  assert.equal(Object.prototype.hasOwnProperty.call(found, 'password'), false);
});
