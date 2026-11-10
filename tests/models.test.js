const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const User = require('../src/models/User');
const Note = require('../src/models/Note');
const Post = require('../src/models/Post');

const TEST_MONGO_URI =
  process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/secure_notes_test_models';

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
  // Index builds happen in the background after connect() resolves; without
  // this, a test could run before an index is actually active on a fresh database.
  await Promise.all([User.createIndexes(), Note.createIndexes(), Post.createIndexes()]);
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Note.deleteMany({}),
    Post.deleteMany({}),
  ]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

function buildUserPayload(overrides = {}) {
  return {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'Ada.Lovelace@Example.com',
    password: 'Sup3rSecret!',
    ...overrides,
  };
}

test('User: creates with required fields and defaults', async () => {
  const user = await User.create(buildUserPayload());

  assert.equal(user.role, 'user');
  assert.deepEqual(user.interests, []);
  assert.equal(user.email, 'ada.lovelace@example.com');
});

test('User: rejects missing required fields', async () => {
  await assert.rejects(
    () => User.create({ email: 'missing-fields@example.com', password: 'x' }),
    (error) => {
      assert.equal(error.name, 'ValidationError');
      assert.ok(error.errors.firstName);
      assert.ok(error.errors.lastName);
      return true;
    }
  );
});

test('User: rejects an invalid role value', async () => {
  await assert.rejects(() =>
    User.create(buildUserPayload({ email: 'bad-role@example.com', role: 'superadmin' }))
  );
});

test('User: enforces unique email', async () => {
  await User.create(buildUserPayload({ email: 'dup@example.com' }));

  await assert.rejects(
    () => User.create(buildUserPayload({ email: 'dup@example.com' })),
    (error) => {
      assert.equal(error.code, 11000);
      return true;
    }
  );
});

test('User: hashes the password on save and never stores it in plain text', async () => {
  const plainPassword = 'Sup3rSecret!';
  const user = await User.create(buildUserPayload({ email: 'hash@example.com', password: plainPassword }));

  const stored = await User.findById(user._id).select('+password');
  assert.notEqual(stored.password, plainPassword);
  assert.ok(stored.password.startsWith('$2'));
});

test('User: comparePassword matches the original password and rejects wrong ones', async () => {
  const plainPassword = 'Sup3rSecret!';
  const user = await User.create(buildUserPayload({ email: 'compare@example.com', password: plainPassword }));

  const stored = await User.findById(user._id).select('+password');
  assert.equal(await stored.comparePassword(plainPassword), true);
  assert.equal(await stored.comparePassword('wrong-password'), false);
});

test('User: does not re-hash the password when other fields are updated', async () => {
  const user = await User.create(buildUserPayload({ email: 'rehash@example.com' }));
  const stored = await User.findById(user._id).select('+password');
  const firstHash = stored.password;

  stored.firstName = 'Updated';
  await stored.save();

  const afterUpdate = await User.findById(user._id).select('+password');
  assert.equal(afterUpdate.password, firstHash);
});

test('User: password is excluded by default queries and from JSON output', async () => {
  const user = await User.create(buildUserPayload({ email: 'serialize@example.com' }));

  const defaultLoad = await User.findById(user._id);
  assert.equal(defaultLoad.password, undefined);

  const withPassword = await User.findById(user._id).select('+password');
  const serialized = withPassword.toJSON();
  assert.equal(serialized.password, undefined);
});

test('User: declares exactly the expected explicit indexes', () => {
  const indexes = User.schema.indexes();
  const emailIndex = indexes.find(([keys]) => Object.keys(keys).join(',') === 'email');
  const createdAtIndex = indexes.find(
    ([keys]) => Object.keys(keys).join(',') === 'createdAt,_id'
  );

  assert.ok(emailIndex, 'expected an index on email');
  assert.equal(emailIndex[1].unique, true);
  assert.equal(emailIndex[0].email, 1);

  assert.ok(createdAtIndex, 'expected a createdAt+_id index');
  assert.equal(createdAtIndex[0].createdAt, -1);
  assert.equal(createdAtIndex[0]._id, -1);

  assert.equal(indexes.length, 2, 'no unexpected indexes, e.g. on interests');
});

test('Note: creates with required fields referencing a user', async () => {
  const user = await User.create(buildUserPayload({ email: 'note-owner@example.com' }));
  const note = await Note.create({ title: 'Title', content: 'Content', userId: user._id });

  assert.equal(note.userId.toString(), user._id.toString());
});

test('Note: rejects missing required fields', async () => {
  await assert.rejects(() => Note.create({ title: 'Only a title' }));
});

test('Note: content defaults to an empty string when omitted', async () => {
  const user = await User.create(buildUserPayload({ email: 'note-no-content@example.com' }));
  const note = await Note.create({ title: 'Title only', userId: user._id });

  assert.equal(note.content, '');
});

test('Note: rejects a title longer than 150 characters', async () => {
  const user = await User.create(buildUserPayload({ email: 'note-long-title@example.com' }));
  await assert.rejects(() => Note.create({ title: 'a'.repeat(151), content: 'c', userId: user._id }));
});

test('Note: accepts a title exactly 150 characters long', async () => {
  const user = await User.create(buildUserPayload({ email: 'note-max-title@example.com' }));
  const note = await Note.create({ title: 'a'.repeat(150), content: 'c', userId: user._id });

  assert.equal(note.title.length, 150);
});

test('Note: declares exactly the expected explicit indexes', () => {
  const indexes = Note.schema.indexes();

  const ownerScopedIndex = indexes.find(([keys]) => Object.keys(keys)[0] === 'userId');
  const globalIndex = indexes.find(
    ([keys]) => Object.keys(keys).join(',') === 'createdAt,_id'
  );
  const standaloneUserIdIndex = indexes.find(
    ([keys]) => Object.keys(keys).length === 1 && Object.keys(keys)[0] === 'userId'
  );

  assert.ok(ownerScopedIndex, 'expected the userId-prefixed compound index');
  assert.deepEqual(ownerScopedIndex[0], { userId: 1, createdAt: -1, _id: -1 });

  assert.ok(globalIndex, 'expected the createdAt+_id index for the admin global listing');
  assert.deepEqual(globalIndex[0], { createdAt: -1, _id: -1 });

  assert.equal(standaloneUserIdIndex, undefined, 'no standalone userId-only index should exist');

  assert.equal(indexes.length, 2, 'no unexpected indexes beyond these two justified ones');
});

test('Post: creates with required fields referencing a user', async () => {
  const user = await User.create(buildUserPayload({ email: 'post-owner@example.com' }));
  const post = await Post.create({ title: 'Title', content: 'Content', userId: user._id });

  assert.equal(post.userId.toString(), user._id.toString());
});

test('Post: rejects missing required fields', async () => {
  await assert.rejects(() => Post.create({ title: 'Only a title' }));
});

test('Post: declares the per-user lookup index and the public newest-first index, no standalone userId index', () => {
  const indexes = Post.schema.indexes();

  const lookupIndex = indexes.find(([keys]) => Object.keys(keys)[0] === 'userId');
  const globalIndex = indexes.find(
    ([keys]) => Object.keys(keys).join(',') === 'createdAt,_id'
  );
  const standaloneUserIdIndex = indexes.find(
    ([keys]) => Object.keys(keys).length === 1 && Object.keys(keys)[0] === 'userId'
  );

  assert.ok(lookupIndex, 'expected a userId-prefixed compound index');
  assert.deepEqual(lookupIndex[0], { userId: 1, createdAt: -1, _id: -1 });

  assert.ok(globalIndex, 'expected a createdAt+_id index for the public listing');

  assert.equal(standaloneUserIdIndex, undefined, 'no standalone userId-only index should exist');

  assert.equal(indexes.length, 2);
});
