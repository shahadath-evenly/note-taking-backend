const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const app = require('../src/app');
const User = require('../src/models/User');
const { signToken } = require('../src/utils/jwt');

const TEST_MONGO_URI =
  process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/secure_notes_test_auth';

let server;
let baseUrl;

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
  // Index builds (e.g. the unique email index) happen in the background after
  // connect() resolves; without this, a test could run before a uniqueness
  // constraint is actually active on a fresh database.
  await User.createIndexes();
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

beforeEach(async () => {
  await User.deleteMany({});
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

function postJson(path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function getJson(path, headers = {}) {
  return fetch(`${baseUrl}${path}`, { method: 'GET', headers });
}

function validRegisterPayload(overrides = {}) {
  return {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    password: 'Sup3rSecret!',
    ...overrides,
  };
}

test('POST /register: creates a normal user and never returns the password', async () => {
  const res = await postJson('/api/auth/register', validRegisterPayload());
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.data.role, 'user');
  assert.equal(body.data.email, 'ada@example.com');
  assert.equal(body.data.password, undefined);
});

test('POST /register: attempted role escalation is ignored, user is created with role "user"', async () => {
  const res = await postJson(
    '/api/auth/register',
    validRegisterPayload({ email: 'escalate@example.com', role: 'admin' })
  );
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.data.role, 'user');

  const stored = await User.findOne({ email: 'escalate@example.com' });
  assert.equal(stored.role, 'user');
});

test('POST /register: the stored password is bcrypt-hashed, not plain text', async () => {
  await postJson('/api/auth/register', validRegisterPayload({ email: 'hashcheck@example.com' }));

  const stored = await User.findOne({ email: 'hashcheck@example.com' }).select('+password');
  assert.notEqual(stored.password, 'Sup3rSecret!');
  assert.ok(stored.password.startsWith('$2'));
});

test('POST /register: rejects a request missing required fields', async () => {
  const res = await postJson('/api/auth/register', { email: 'incomplete@example.com' });
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(body.success, false);
});

test('POST /register: rejects a duplicate email with a safe conflict response', async () => {
  await postJson('/api/auth/register', validRegisterPayload({ email: 'dup@example.com' }));
  const res = await postJson('/api/auth/register', validRegisterPayload({ email: 'dup@example.com' }));
  const body = await res.json();

  assert.equal(res.status, 409);
  assert.equal(body.success, false);
});

test('POST /login: succeeds with correct credentials and returns a safe user plus a token', async () => {
  await postJson('/api/auth/register', validRegisterPayload({ email: 'login@example.com' }));

  const res = await postJson('/api/auth/login', { email: 'login@example.com', password: 'Sup3rSecret!' });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.user.email, 'login@example.com');
  assert.equal(body.data.user.password, undefined);
  assert.equal(typeof body.data.token, 'string');
});

test('POST /login: rejects an incorrect password with a generic message', async () => {
  await postJson('/api/auth/register', validRegisterPayload({ email: 'wrongpass@example.com' }));

  const res = await postJson('/api/auth/login', { email: 'wrongpass@example.com', password: 'wrong-one' });
  const body = await res.json();

  assert.equal(res.status, 401);
  assert.equal(body.message, 'Invalid email or password');
});

test('POST /login: rejects a non-existent email with the same generic message', async () => {
  const res = await postJson('/api/auth/login', { email: 'nobody@example.com', password: 'whatever123' });
  const body = await res.json();

  assert.equal(res.status, 401);
  assert.equal(body.message, 'Invalid email or password');
});

test('GET /me: returns the authenticated user profile without the password', async () => {
  await postJson('/api/auth/register', validRegisterPayload({ email: 'me@example.com' }));
  const loginRes = await postJson('/api/auth/login', { email: 'me@example.com', password: 'Sup3rSecret!' });
  const { data } = await loginRes.json();

  const res = await getJson('/api/auth/me', { Authorization: `Bearer ${data.token}` });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.email, 'me@example.com');
  assert.equal(body.data.password, undefined);
});

test('GET /me: rejects a request with no Authorization header', async () => {
  const res = await getJson('/api/auth/me');
  assert.equal(res.status, 401);
});

test('GET /me: rejects a malformed/garbage token', async () => {
  const res = await getJson('/api/auth/me', { Authorization: 'Bearer not-a-real-token' });
  assert.equal(res.status, 401);
});

test('GET /me: rejects an expired token', async () => {
  const expiredToken = require('jsonwebtoken').sign(
    { userId: 'anything', role: 'user' },
    require('../src/config/env').jwtSecret,
    { expiresIn: -10 }
  );

  const res = await getJson('/api/auth/me', { Authorization: `Bearer ${expiredToken}` });
  assert.equal(res.status, 401);
});

test('GET /me: rejects a valid token whose user no longer exists', async () => {
  const user = await User.create(validRegisterPayload({ email: 'deleted@example.com' }));
  const token = signToken({ userId: user._id.toString(), role: user.role });
  await User.deleteOne({ _id: user._id });

  const res = await getJson('/api/auth/me', { Authorization: `Bearer ${token}` });
  assert.equal(res.status, 401);
});
