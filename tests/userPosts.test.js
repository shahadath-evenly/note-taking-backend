const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const app = require('../src/app');
const User = require('../src/models/User');
const Post = require('../src/models/Post');

const TEST_MONGO_URI =
  process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/secure_notes_test_user_posts';

let server;
let baseUrl;
let uniqueCounter = 0;

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
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

function request(path) {
  return fetch(`${baseUrl}${path}`);
}

function spyOnModelMethods(Model, methodNames) {
  const originals = {};
  const counts = {};
  const calls = {};

  for (const name of methodNames) {
    if (typeof Model[name] !== 'function') {
      continue;
    }
    originals[name] = Model[name];
    counts[name] = 0;
    calls[name] = [];
    Model[name] = function spied(...args) {
      counts[name] += 1;
      calls[name].push(args);
      return originals[name].apply(Model, args);
    };
  }

  return {
    counts,
    calls,
    restore() {
      for (const name of Object.keys(originals)) {
        Model[name] = originals[name];
      }
    },
  };
}

// --- Critical constraints ----------------------------------------------------

test('uses exactly one User.aggregate() call, with a $lookup stage, and no Post query of any kind', async () => {
  const user = await createUserDirect();
  await Post.create({ title: 'Post', content: 'c', userId: user._id });

  const userSpies = spyOnModelMethods(User, ['aggregate']);
  const postSpies = spyOnModelMethods(Post, [
    'find',
    'findOne',
    'distinct',
    'countDocuments',
    'estimatedDocumentCount',
    'populate',
  ]);

  try {
    const res = await request(`/api/users/${user._id}/posts`);
    assert.equal(res.status, 200);

    assert.equal(userSpies.counts.aggregate, 1, 'User.aggregate must be called exactly once');

    const [pipeline] = userSpies.calls.aggregate[0];
    const hasLookup = pipeline.some((stage) => '$lookup' in stage);
    assert.ok(hasLookup, 'the pipeline must contain a $lookup stage');

    for (const name of Object.keys(postSpies.counts)) {
      assert.equal(postSpies.counts[name], 0, `Post.${name} must never be called by this endpoint`);
    }
  } finally {
    userSpies.restore();
    postSpies.restore();
  }
});

// --- Correctness ---------------------------------------------------------------

test('matches the correct user and returns only that user\'s posts, newest-first', async () => {
  const userA = await createUserDirect();
  const userB = await createUserDirect();

  await Post.create({ title: 'B post', content: 'c', userId: userB._id });
  const first = await Post.create({ title: 'A post 1', content: 'c', userId: userA._id });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await Post.create({ title: 'A post 2', content: 'c', userId: userA._id });

  const res = await request(`/api/users/${userA._id}/posts`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.user._id, userA._id.toString());
  assert.equal(body.data.posts.length, 2);
  assert.equal(body.data.posts[0]._id, second._id.toString(), 'newest post first');
  assert.equal(body.data.posts[1]._id, first._id.toString());
  assert.ok(body.data.posts.every((p) => p.userId === userA._id.toString()));
});

test('returns an empty posts array with zero total for a user who has none', async () => {
  const user = await createUserDirect();

  const res = await request(`/api/users/${user._id}/posts`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body.data.posts, []);
  assert.equal(body.pagination.total, 0);
});

// --- Pagination and count metadata ----------------------------------------------

test('pagination: respects page/limit and computes correct metadata inside the pipeline', async () => {
  const user = await createUserDirect();
  await Promise.all(
    Array.from({ length: 14 }, (_, i) => Post.create({ title: `Post ${i}`, content: 'c', userId: user._id }))
  );

  const res = await request(`/api/users/${user._id}/posts?page=2&limit=5`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.posts.length, 5);
  assert.deepEqual(body.pagination, { page: 2, limit: 5, total: 14, totalPages: 3 });
});

test('pagination: a page beyond the last page returns an empty array with correct metadata', async () => {
  const user = await createUserDirect();
  await Post.create({ title: 'Only one', content: 'c', userId: user._id });

  const res = await request(`/api/users/${user._id}/posts?page=99&limit=10`);
  const body = await res.json();

  assert.deepEqual(body.data.posts, []);
  assert.equal(body.pagination.total, 1);
});

test('pagination: rejects a limit above the maximum', async () => {
  const user = await createUserDirect();
  const res = await request(`/api/users/${user._id}/posts?limit=500`);
  assert.equal(res.status, 400);
});

// --- Safety and error handling -----------------------------------------------------

test('never returns a password field for the user', async () => {
  const user = await createUserDirect();

  const res = await request(`/api/users/${user._id}/posts`);
  const body = await res.json();

  assert.equal(Object.prototype.hasOwnProperty.call(body.data.user, 'password'), false);
});

test('returns 400 for a malformed user ID instead of crashing', async () => {
  const res = await request('/api/users/not-a-valid-id/posts');
  assert.equal(res.status, 400);
});

test('returns 404 for a well-formed but non-existent user ID', async () => {
  const fakeId = new mongoose.Types.ObjectId();
  const res = await request(`/api/users/${fakeId}/posts`);
  assert.equal(res.status, 404);
});

test('this endpoint is public: no Authorization header is required', async () => {
  const user = await createUserDirect();
  const res = await request(`/api/users/${user._id}/posts`);
  assert.equal(res.status, 200);
});
