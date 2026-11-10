const { test } = require('node:test');
const assert = require('node:assert/strict');
const yup = require('yup');

const ApiError = require('../src/utils/ApiError');
const ApiResponse = require('../src/utils/ApiResponse');
const asyncHandler = require('../src/utils/asyncHandler');
const notFound = require('../src/middlewares/notFound');
const errorHandler = require('../src/middlewares/errorHandler');
const validateRequest = require('../src/middlewares/validateRequest');

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('ApiError: static helpers assign the expected status codes', () => {
  assert.equal(ApiError.badRequest('x').statusCode, 400);
  assert.equal(ApiError.unauthorized().statusCode, 401);
  assert.equal(ApiError.forbidden().statusCode, 403);
  assert.equal(ApiError.notFound().statusCode, 404);
  assert.equal(ApiError.conflict().statusCode, 409);
  assert.equal(ApiError.internal().statusCode, 500);
});

test('ApiError: carries an optional errors payload', () => {
  const error = ApiError.badRequest('Validation failed', [{ field: 'email', message: 'Invalid' }]);
  assert.equal(error.errors.length, 1);
  assert.equal(error instanceof Error, true);
});

test('ApiResponse: shapes a success body matching the documented contract', () => {
  const res = mockRes();
  new ApiResponse(201, 'Created', { id: 1 }).send(res);

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { success: true, message: 'Created', data: { id: 1 } });
});

test('ApiResponse: includes pagination only when provided', () => {
  const res = mockRes();
  new ApiResponse(200, 'Records retrieved successfully', [], {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  }).send(res);

  assert.equal(res.body.pagination.total, 0);

  const resWithoutPagination = mockRes();
  new ApiResponse(200, 'ok', {}).send(resWithoutPagination);
  assert.equal('pagination' in resWithoutPagination.body, false);
});

test('asyncHandler: forwards a rejected promise to next instead of throwing', async () => {
  const boom = new Error('boom');
  const handler = asyncHandler(async () => {
    throw boom;
  });

  let received;
  await handler({}, mockRes(), (err) => {
    received = err;
  });

  assert.equal(received, boom);
});

test('asyncHandler: does not call next on success', async () => {
  const handler = asyncHandler(async (req, res) => {
    res.json({ ok: true });
  });

  let called = false;
  const res = mockRes();
  await handler({}, res, () => {
    called = true;
  });

  assert.equal(called, false);
  assert.deepEqual(res.body, { ok: true });
});

test('notFound: produces a 404 ApiError describing the missing route', () => {
  const req = { method: 'GET', originalUrl: '/does-not-exist' };
  let received;

  notFound(req, {}, (err) => {
    received = err;
  });

  assert.ok(received instanceof ApiError);
  assert.equal(received.statusCode, 404);
  assert.match(received.message, /GET \/does-not-exist/);
});

test('errorHandler: passes through an ApiError unchanged', () => {
  const res = mockRes();
  errorHandler(ApiError.forbidden('Nope'), {}, res, () => {});

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { success: false, message: 'Nope' });
});

test('errorHandler: normalizes a Mongoose-style ValidationError to 400 with field details', () => {
  const res = mockRes();
  const mongooseLikeError = {
    name: 'ValidationError',
    errors: {
      email: { path: 'email', message: 'Email is required' },
    },
  };

  errorHandler(mongooseLikeError, {}, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errors[0].field, 'email');
});

test('errorHandler: normalizes a Mongoose CastError to 400', () => {
  const res = mockRes();
  errorHandler({ name: 'CastError', path: '_id' }, {}, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /_id/);
});

test('errorHandler: normalizes a duplicate-key error to 409', () => {
  const res = mockRes();
  errorHandler({ code: 11000, keyValue: { email: 'dup@example.com' } }, {}, res, () => {});

  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /email/);
});

test('errorHandler: defaults an unrecognized error to a 500 failure response', () => {
  const res = mockRes();
  errorHandler(new Error('unexpected failure'), {}, res, () => {});

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
});

test('errorHandler: hides the real message and stack for 500s in production', () => {
  process.env.NODE_ENV = 'production';
  delete require.cache[require.resolve('../src/config/env')];
  delete require.cache[require.resolve('../src/middlewares/errorHandler')];
  const prodErrorHandler = require('../src/middlewares/errorHandler');

  const res = mockRes();
  prodErrorHandler(new Error('leaky internal detail'), {}, res, () => {});

  assert.equal(res.body.message, 'Internal server error');
  assert.equal('stack' in res.body, false);

  process.env.NODE_ENV = 'development';
  delete require.cache[require.resolve('../src/config/env')];
  delete require.cache[require.resolve('../src/middlewares/errorHandler')];
});

test('validateRequest: strips unknown fields and normalizes known ones', async () => {
  const schema = yup.object({
    email: yup.string().trim().lowercase().email().required(),
  });
  const middleware = validateRequest(schema);

  const req = { body: { email: '  Test@Example.com  ', role: 'admin' } };
  let nextCalledWith = 'not-called';

  await middleware(req, {}, (err) => {
    nextCalledWith = err;
  });

  assert.equal(nextCalledWith, undefined);
  assert.deepEqual(req.body, { email: 'test@example.com' });
});

test('validateRequest: rejects invalid input with a 400 ApiError and field-level details', async () => {
  const schema = yup.object({
    email: yup.string().email('Invalid email address').required('Email is required'),
    password: yup.string().required('Password is required'),
  });
  const middleware = validateRequest(schema);

  const req = { body: { email: 'not-an-email' } };
  let received;

  await middleware(req, {}, (err) => {
    received = err;
  });

  assert.ok(received instanceof ApiError);
  assert.equal(received.statusCode, 400);
  const fields = received.errors.map((e) => e.field).sort();
  assert.deepEqual(fields, ['email', 'password']);
});

test('validateRequest: validates query params when a source is specified', async () => {
  const schema = yup.object({
    page: yup.number().integer().min(1),
  });
  const middleware = validateRequest(schema, 'query');

  const req = { query: { page: '2' } };
  let nextCalledWith = 'not-called';

  await middleware(req, {}, (err) => {
    nextCalledWith = err;
  });

  assert.equal(nextCalledWith, undefined);
  assert.equal(req.query.page, 2);
});
