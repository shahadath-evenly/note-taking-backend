const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const app = require('../src/app');
const User = require('../src/models/User');
const { signToken } = require('../src/utils/jwt');
const { ROLES } = require('../src/constants/roles');

const TEST_MONGO_URI =
  process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/secure_notes_test_interest_groups';

let server;
let baseUrl;
let uniqueCounter = 0;

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
  // Index builds happen in the background after connect() resolves; without
  // this, a test could run before an index is actually active on a fresh database.
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

function request(path, { method = 'GET', token } = {}) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return fetch(`${baseUrl}${path}`, { method, headers });
}

function spyOnUserMethods(methodNames) {
  const originals = {};
  const counts = {};

  for (const name of methodNames) {
    if (typeof User[name] !== 'function') {
      continue;
    }
    originals[name] = User[name];
    counts[name] = 0;
    User[name] = function spied(...args) {
      counts[name] += 1;
      return originals[name].apply(User, args);
    };
  }

  return {
    counts,
    restore() {
      for (const name of Object.keys(originals)) {
        User[name] = originals[name];
      }
    },
  };
}

function findGroup(groups, interest) {
  return groups.find((g) => g.interest === interest);
}

// --- Authorization ---------------------------------------------------------

test('authorization: rejects requests with no token', async () => {
  const res = await request('/api/admin/users/grouped-by-interests');
  assert.equal(res.status, 401);
});

test('authorization: rejects a normal user with 403', async () => {
  const normalUser = await createUserDirect();
  const res = await request('/api/admin/users/grouped-by-interests', { token: tokenFor(normalUser) });
  assert.equal(res.status, 403);
});

// --- Critical constraint: exactly one aggregate call -------------------------

test('uses exactly one User.aggregate() call and no supplementary Mongoose query method', async () => {
  const admin = await createAdminDirect();
  await createUserDirect({ interests: ['chess'] });

  const spies = spyOnUserMethods([
    'aggregate',
    'find',
    'findOne',
    'distinct',
    'countDocuments',
    'estimatedDocumentCount',
    'populate',
  ]);

  try {
    const res = await request('/api/admin/users/grouped-by-interests', { token: tokenFor(admin) });
    assert.equal(res.status, 200);

    assert.equal(spies.counts.aggregate, 1, 'aggregate must be called exactly once');
    for (const name of ['find', 'findOne', 'distinct', 'countDocuments', 'estimatedDocumentCount', 'populate']) {
      if (name in spies.counts) {
        assert.equal(spies.counts[name], 0, `${name} must never be called by this endpoint`);
      }
    }
  } finally {
    spies.restore();
  }
});

// --- Grouping behavior ---------------------------------------------------------

test('a user with multiple interests appears in every matching group', async () => {
  const admin = await createAdminDirect();
  const user = await createUserDirect({ interests: ['chess', 'reading'] });

  const res = await request('/api/admin/users/grouped-by-interests?limit=100', { token: tokenFor(admin) });
  const body = await res.json();

  const chessGroup = findGroup(body.data, 'chess');
  const readingGroup = findGroup(body.data, 'reading');

  assert.ok(chessGroup, 'expected a chess group');
  assert.ok(readingGroup, 'expected a reading group');
  assert.ok(chessGroup.users.some((u) => u.email === user.email));
  assert.ok(readingGroup.users.some((u) => u.email === user.email));
});

test('a repeated interest value does not duplicate the user within that group', async () => {
  const admin = await createAdminDirect();
  const user = await createUserDirect({ interests: ['chess', 'chess', 'chess'] });

  const res = await request('/api/admin/users/grouped-by-interests?limit=100', { token: tokenFor(admin) });
  const body = await res.json();

  const chessGroup = findGroup(body.data, 'chess');
  const occurrences = chessGroup.users.filter((u) => u.email === user.email);

  assert.equal(occurrences.length, 1, 'the user must appear exactly once, not three times');
});

test('users with empty interests are excluded from every group', async () => {
  const admin = await createAdminDirect();
  const noInterestsUser = await createUserDirect({ interests: [] });
  await createUserDirect({ interests: ['chess'] });

  const res = await request('/api/admin/users/grouped-by-interests?limit=100', { token: tokenFor(admin) });
  const body = await res.json();

  const appearsAnywhere = body.data.some((group) =>
    group.users.some((u) => u.email === noInterestsUser.email)
  );
  assert.equal(appearsAnywhere, false);
});

test('groups are returned in stable ascending order by interest name', async () => {
  const admin = await createAdminDirect();
  await createUserDirect({ interests: ['zebra'] });
  await createUserDirect({ interests: ['apple'] });
  await createUserDirect({ interests: ['mango'] });

  const res = await request('/api/admin/users/grouped-by-interests?limit=100', { token: tokenFor(admin) });
  const body = await res.json();
  const interestNames = body.data.map((g) => g.interest);

  assert.deepEqual([...interestNames].sort(), interestNames);
});

// --- Pagination and total count -------------------------------------------------

test('pagination: paginates groups and computes the total group count inside the pipeline', async () => {
  const admin = await createAdminDirect();
  const interests = Array.from({ length: 14 }, (_, i) => `interest-${i}`);
  await Promise.all(interests.map((interest) => createUserDirect({ interests: [interest] })));

  const res = await request('/api/admin/users/grouped-by-interests?page=2&limit=5', { token: tokenFor(admin) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.length, 5);
  assert.deepEqual(body.pagination, { page: 2, limit: 5, total: 14, totalPages: 3 });
});

test('pagination: a page beyond the last page returns an empty array with correct metadata', async () => {
  const admin = await createAdminDirect();
  await createUserDirect({ interests: ['solo'] });

  const res = await request('/api/admin/users/grouped-by-interests?page=99&limit=10', { token: tokenFor(admin) });
  const body = await res.json();

  assert.deepEqual(body.data, []);
  assert.equal(body.pagination.total, 1);
});

// --- Safe serialization -----------------------------------------------------------

test('no group ever includes a password field for any user', async () => {
  const admin = await createAdminDirect();
  await createUserDirect({ interests: ['chess', 'reading'] });
  await createUserDirect({ interests: ['chess'] });

  const res = await request('/api/admin/users/grouped-by-interests?limit=100', { token: tokenFor(admin) });
  const body = await res.json();

  for (const group of body.data) {
    for (const user of group.users) {
      assert.equal(Object.prototype.hasOwnProperty.call(user, 'password'), false);
    }
  }
});
