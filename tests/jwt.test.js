const { test } = require('node:test');
const assert = require('node:assert/strict');

const { signToken, verifyToken } = require('../src/utils/jwt');

test('signToken/verifyToken: round-trips the payload', () => {
  const token = signToken({ userId: 'abc123', role: 'user' });
  const decoded = verifyToken(token);

  assert.equal(decoded.userId, 'abc123');
  assert.equal(decoded.role, 'user');
  assert.ok(decoded.exp, 'expiry claim should be set');
});

test('verifyToken: throws on a malformed token', () => {
  assert.throws(() => verifyToken('not-a-real-token'));
});

test('verifyToken: throws on a token signed with a different secret', () => {
  const jwt = require('jsonwebtoken');
  const foreignToken = jwt.sign({ userId: 'x' }, 'a-completely-different-secret-value');

  assert.throws(() => verifyToken(foreignToken));
});

test('verifyToken: throws on an expired token', () => {
  const expiredToken = signTokenWithCustomExpiry({ userId: 'abc123', role: 'user' }, -10);
  assert.throws(() => verifyToken(expiredToken), /jwt expired/);
});

function signTokenWithCustomExpiry(payload, expiresInSeconds) {
  const jwt = require('jsonwebtoken');
  const config = require('../src/config/env');
  return jwt.sign(payload, config.jwtSecret, { expiresIn: expiresInSeconds });
}
