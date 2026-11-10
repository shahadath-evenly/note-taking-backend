const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const app = require('../src/app');
const User = require('../src/models/User');
const { signToken } = require('../src/utils/jwt');
const { ROLES } = require('../src/constants/roles');

const TEST_MONGO_URI =
  process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/secure_notes_test_admin_users';

let server;
let baseUrl;
let uniqueCounter = 0;

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
  // Index builds (e.g. the unique email index) happen in the background after
  // connect() resolves; without this, a test could run before a uniqueness
  // constraint is actually active on a fresh database.
  await User.createIndexes();
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  await User.deleteMany({});
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

// --- Authorization ---------------------------------------------------------

test('authorization: rejects requests with no token', async () => {
  const res = await request('/api/admin/users');
  assert.equal(res.status, 401);
});

test('authorization: rejects a normal user with 403', async () => {
  const normalUser = await createUserDirect();
  const res = await request('/api/admin/users', { token: tokenFor(normalUser) });
  assert.equal(res.status, 403);
});

test('authorization: allows an admin to list users', async () => {
  const admin = await createAdminDirect();
  const res = await request('/api/admin/users', { token: tokenFor(admin) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data));
  assert.ok(body.pagination);
});

// --- Create ------------------------------------------------------------------

test('create: an admin can create a new user', async () => {
  const admin = await createAdminDirect();
  const res = await request('/api/admin/users', {
    method: 'POST',
    token: tokenFor(admin),
    body: {
      firstName: 'New',
      lastName: 'Person',
      email: uniqueEmail('created'),
      password: 'Sup3rSecret!',
    },
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.data.role, 'user');
  assert.equal(body.data.password, undefined);
});

test('create: an admin can create another admin explicitly', async () => {
  const admin = await createAdminDirect();
  const res = await request('/api/admin/users', {
    method: 'POST',
    token: tokenFor(admin),
    body: {
      firstName: 'New',
      lastName: 'Admin',
      email: uniqueEmail('newadmin'),
      password: 'Sup3rSecret!',
      role: 'admin',
    },
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.data.role, 'admin');
});

test('create: rejects a duplicate email with 409', async () => {
  const admin = await createAdminDirect();
  const email = uniqueEmail('dup');
  await createUserDirect({ email });

  const res = await request('/api/admin/users', {
    method: 'POST',
    token: tokenFor(admin),
    body: { firstName: 'X', lastName: 'Y', email, password: 'Sup3rSecret!' },
  });

  assert.equal(res.status, 409);
});

test('create: rejects a request missing required fields', async () => {
  const admin = await createAdminDirect();
  const res = await request('/api/admin/users', {
    method: 'POST',
    token: tokenFor(admin),
    body: { email: uniqueEmail('incomplete') },
  });
  assert.equal(res.status, 400);
});

test('create: a normal user is forbidden from creating users', async () => {
  const normalUser = await createUserDirect();
  const res = await request('/api/admin/users', {
    method: 'POST',
    token: tokenFor(normalUser),
    body: { firstName: 'X', lastName: 'Y', email: uniqueEmail('blocked'), password: 'Sup3rSecret!' },
  });
  assert.equal(res.status, 403);
});

// --- Get one -----------------------------------------------------------------

test('get: an admin can retrieve a single user without the password', async () => {
  const admin = await createAdminDirect();
  const target = await createUserDirect();

  const res = await request(`/api/admin/users/${target._id}`, { token: tokenFor(admin) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.email, target.email);
  assert.equal(body.data.password, undefined);
});

test('get: returns 404 for a well-formed but non-existent id', async () => {
  const admin = await createAdminDirect();
  const fakeId = new mongoose.Types.ObjectId();

  const res = await request(`/api/admin/users/${fakeId}`, { token: tokenFor(admin) });
  assert.equal(res.status, 404);
});

test('get: returns 400 for a malformed id', async () => {
  const admin = await createAdminDirect();
  const res = await request('/api/admin/users/not-a-valid-id', { token: tokenFor(admin) });
  assert.equal(res.status, 400);
});

// --- Update ------------------------------------------------------------------

test('update: an admin can update a user\'s basic info', async () => {
  const admin = await createAdminDirect();
  const target = await createUserDirect();

  const res = await request(`/api/admin/users/${target._id}`, {
    method: 'PATCH',
    token: tokenFor(admin),
    body: { firstName: 'Updated' },
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.firstName, 'Updated');
});

test('update: an admin can promote a user to admin', async () => {
  const admin = await createAdminDirect();
  const target = await createUserDirect();

  const res = await request(`/api/admin/users/${target._id}`, {
    method: 'PATCH',
    token: tokenFor(admin),
    body: { role: 'admin' },
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.role, 'admin');
});

test('update: demoting a non-last admin succeeds', async () => {
  const admin = await createAdminDirect();
  const otherAdmin = await createAdminDirect();

  const res = await request(`/api/admin/users/${otherAdmin._id}`, {
    method: 'PATCH',
    token: tokenFor(admin),
    body: { role: 'user' },
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.role, 'user');
});

test('update: demoting the last remaining admin is blocked', async () => {
  const onlyAdmin = await createAdminDirect();

  const res = await request(`/api/admin/users/${onlyAdmin._id}`, {
    method: 'PATCH',
    token: tokenFor(onlyAdmin),
    body: { role: 'user' },
  });

  assert.equal(res.status, 409);

  const stillAdmin = await User.findById(onlyAdmin._id);
  assert.equal(stillAdmin.role, 'admin');
});

test('update: rejects an empty update body', async () => {
  const admin = await createAdminDirect();
  const target = await createUserDirect();

  const res = await request(`/api/admin/users/${target._id}`, {
    method: 'PATCH',
    token: tokenFor(admin),
    body: {},
  });
  assert.equal(res.status, 400);
});

test('update: a normal user is forbidden from updating users', async () => {
  const normalUser = await createUserDirect();
  const target = await createUserDirect();

  const res = await request(`/api/admin/users/${target._id}`, {
    method: 'PATCH',
    token: tokenFor(normalUser),
    body: { firstName: 'Hacked' },
  });
  assert.equal(res.status, 403);
});

// --- Delete ------------------------------------------------------------------

test('delete: an admin can delete a normal user', async () => {
  const admin = await createAdminDirect();
  const target = await createUserDirect();

  const res = await request(`/api/admin/users/${target._id}`, { method: 'DELETE', token: tokenFor(admin) });
  assert.equal(res.status, 200);

  const stillThere = await User.findById(target._id);
  assert.equal(stillThere, null);
});

test('delete: an admin cannot delete their own account', async () => {
  const admin = await createAdminDirect();

  const res = await request(`/api/admin/users/${admin._id}`, { method: 'DELETE', token: tokenFor(admin) });
  assert.equal(res.status, 403);

  const stillThere = await User.findById(admin._id);
  assert.ok(stillThere);
});

test('delete: deleting the last remaining admin is blocked at the service layer', async () => {
  // Through the HTTP API, only an admin can call this endpoint, so deleting
  // the sole remaining admin always collapses into the self-deletion case
  // (already covered above). This exercises the independent last-admin guard
  // directly, as if a different caller attempted it.
  const userService = require('../src/services/user.service');
  const onlyAdmin = await createAdminDirect();

  await assert.rejects(
    () => userService.deleteUser(onlyAdmin._id.toString(), 'not-the-target-id'),
    (error) => {
      assert.equal(error.statusCode, 409);
      return true;
    }
  );

  const stillThere = await User.findById(onlyAdmin._id);
  assert.ok(stillThere);
});

test('delete: a normal user is forbidden from deleting users', async () => {
  const normalUser = await createUserDirect();
  const target = await createUserDirect();

  const res = await request(`/api/admin/users/${target._id}`, {
    method: 'DELETE',
    token: tokenFor(normalUser),
  });
  assert.equal(res.status, 403);
});

test('delete: returns 404 for a non-existent id', async () => {
  const admin = await createAdminDirect();
  const fakeId = new mongoose.Types.ObjectId();

  const res = await request(`/api/admin/users/${fakeId}`, { method: 'DELETE', token: tokenFor(admin) });
  assert.equal(res.status, 404);
});

// --- Search, filter, sort, pagination ----------------------------------------

test('search: filters by firstName/lastName/email', async () => {
  const admin = await createAdminDirect();
  await createUserDirect({ firstName: 'Zelda', lastName: 'Zephyr', email: uniqueEmail('zelda') });
  await createUserDirect({ firstName: 'Mario', lastName: 'Rossi', email: uniqueEmail('mario') });

  const res = await request('/api/admin/users?search=Zelda', { token: tokenFor(admin) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body.data.every((u) => u.firstName === 'Zelda'));
  assert.ok(body.data.length >= 1);
});

test('role filter: returns only users matching the requested role', async () => {
  const admin = await createAdminDirect();
  await createAdminDirect();
  await createUserDirect();
  await createUserDirect();

  const res = await request('/api/admin/users?role=admin', { token: tokenFor(admin) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(body.data.every((u) => u.role === 'admin'));
});

test('role filter: rejects an invalid role value', async () => {
  const admin = await createAdminDirect();
  const res = await request('/api/admin/users?role=superadmin', { token: tokenFor(admin) });
  assert.equal(res.status, 400);
});

test('sorting: an allow-listed field sorts correctly', async () => {
  const admin = await createAdminDirect();
  await createUserDirect({ firstName: 'Charlie', email: uniqueEmail('charlie') });
  await createUserDirect({ firstName: 'Alice', email: uniqueEmail('alice') });
  await createUserDirect({ firstName: 'Bob', email: uniqueEmail('bob') });

  const res = await request('/api/admin/users?sortBy=firstName&sortOrder=asc&limit=100', {
    token: tokenFor(admin),
  });
  const body = await res.json();
  const names = body.data.map((u) => u.firstName);

  assert.deepEqual([...names].sort(), names);
});

test('sorting: rejects a non-allow-listed sort field', async () => {
  const admin = await createAdminDirect();
  const res = await request('/api/admin/users?sortBy=password', { token: tokenFor(admin) });
  assert.equal(res.status, 400);
});

test('pagination: respects page/limit and computes correct metadata', async () => {
  const admin = await createAdminDirect();
  await Promise.all(Array.from({ length: 14 }, () => createUserDirect()));
  // 14 extra users + 1 admin = 15 total

  const res = await request('/api/admin/users?page=2&limit=5', { token: tokenFor(admin) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.length, 5);
  assert.deepEqual(body.pagination, { page: 2, limit: 5, total: 15, totalPages: 3 });
});

test('pagination: a page beyond the last page returns an empty array with correct metadata', async () => {
  const admin = await createAdminDirect();

  const res = await request('/api/admin/users?page=99&limit=10', { token: tokenFor(admin) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body.data, []);
  assert.equal(body.pagination.page, 99);
  assert.equal(body.pagination.total, 1);
});

test('pagination: rejects a limit above the maximum', async () => {
  const admin = await createAdminDirect();
  const res = await request('/api/admin/users?limit=500', { token: tokenFor(admin) });
  assert.equal(res.status, 400);
});

// --- Safe serialization --------------------------------------------------------

test('serialization: no response ever includes a password field', async () => {
  const admin = await createAdminDirect();
  await createUserDirect();
  await createUserDirect();

  const res = await request('/api/admin/users', { token: tokenFor(admin) });
  const body = await res.json();

  for (const user of body.data) {
    assert.equal(Object.prototype.hasOwnProperty.call(user, 'password'), false);
  }
});
