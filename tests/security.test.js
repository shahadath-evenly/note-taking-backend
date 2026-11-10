const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../src/app');
const config = require('../src/config/env');

// No Mongo connection needed: /health touches no model, so these checks run
// against the real HTTP stack (helmet + cors + the error handler) in
// isolation from any database state.
let server;
let baseUrl;

before(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('security headers: helmet sets protective headers and hides the framework', async () => {
  const res = await fetch(`${baseUrl}/health`);

  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('CORS: reflects only the configured origin, not a wildcard', async () => {
  const res = await fetch(`${baseUrl}/health`, { headers: { Origin: config.corsOrigin } });

  assert.equal(res.headers.get('access-control-allow-origin'), config.corsOrigin);
  assert.notEqual(res.headers.get('access-control-allow-origin'), '*');
});

test('CORS: a preflight request for a protected route is handled without reaching the route handler', async () => {
  const res = await fetch(`${baseUrl}/api/notes`, {
    method: 'OPTIONS',
    headers: {
      Origin: config.corsOrigin,
      'Access-Control-Request-Method': 'GET',
    },
  });

  assert.ok(res.status < 300);
  assert.equal(res.headers.get('access-control-allow-origin'), config.corsOrigin);
});

test('404: an unknown route returns a safe JSON error, not an HTML stack trace', async () => {
  const res = await fetch(`${baseUrl}/api/this-route-does-not-exist`);
  const body = await res.json();

  assert.equal(res.status, 404);
  assert.equal(body.success, false);
  assert.equal('stack' in body, false);
});
