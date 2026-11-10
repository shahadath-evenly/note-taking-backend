process.env.AUTH_RATE_LIMIT_MAX = '3';
process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const app = require('../src/app');

const TEST_MONGO_URI =
  process.env.MONGO_TEST_URI || 'mongodb://localhost:27017/secure_notes_test_rate_limiter';

let server;
let baseUrl;

before(async () => {
  await mongoose.connect(TEST_MONGO_URI);
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('auth rate limiter: blocks requests past the configured maximum within the window', async () => {
  const attempt = () =>
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nope@example.com', password: 'whatever123' }),
    });

  const statuses = [];
  for (let i = 0; i < 4; i += 1) {
    const res = await attempt();
    statuses.push(res.status);
  }

  assert.deepEqual(statuses.slice(0, 3), [401, 401, 401], 'first 3 attempts are normal auth failures');
  assert.equal(statuses[3], 429, '4th attempt within the window must be rate-limited');
});
