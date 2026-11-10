# Secure Notes — Backend

A REST API for a secure, role-based note-taking application: users manage their own private notes and can publish public posts; admins manage users and can view every note and a cross-user interests breakdown.

Built with **Node.js, Express, MongoDB/Mongoose, JWT, and bcrypt**.

## Table of contents

- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Authentication](#authentication)
- [Roles & permissions](#roles--permissions)
- [Response format](#response-format)
- [Pagination, search, sort](#pagination-search-sort)
- [API reference](#api-reference)
  - [Health](#health)
  - [Auth](#auth)
  - [Notes](#notes-authenticated-owner-scoped)
  - [Posts](#posts-public-read-authenticated-write)
  - [User posts (aggregation)](#user-posts-aggregation)
  - [Admin — Users](#admin--users)
  - [Admin — Notes](#admin--notes)
  - [Admin — Grouped interests (aggregation)](#admin--grouped-interests-aggregation)
- [Indexing strategy](#indexing-strategy)
- [Testing](#testing)

## Tech stack

| Concern | Choice |
| --- | --- |
| Runtime / framework | Node.js, Express 5 |
| Database / ODM | MongoDB, Mongoose |
| Auth | JWT (`jsonwebtoken`), bcrypt password hashing (`bcryptjs`) |
| Validation | Yup schemas on every request body/query |
| Security middleware | `helmet`, `cors` (single allow-listed origin), `express-rate-limit` on auth routes |
| Testing | Node's built-in `node:test` + `node:assert/strict`, run against a real MongoDB instance |

## Project structure

```
src/
  app.js                # Express app: middleware, route mounting
  server.js             # Entry point: connects to MongoDB, starts the HTTP server
  config/               # Env validation (env.js), DB connection (database.js)
  constants/            # roles.js, sortFields.js (allow-lists)
  models/               # Mongoose schemas: User, Note, Post
  repositories/         # All Mongoose query/aggregation calls live here
  services/             # Business logic; repositories are the only thing they call for data
  controllers/          # Thin HTTP layer: calls a service, shapes an ApiResponse
  routes/                # Express routers, wiring middleware -> validation -> controller
  middlewares/           # authenticate, authorizeRole, validateRequest, rate limiter, error handling
  validators/            # Yup schemas per route, organized by resource
  utils/                 # ApiError, ApiResponse, asyncHandler, jwt, pagination helpers
  scripts/seedAdmin.js   # One-off script to create the first admin account
tests/                   # node:test suites, one file per resource/concern
docs/INDEX_STRATEGY.md   # Index-by-index justification + explain() evidence
```

## Getting started

```bash
cd backend
npm install
cp .env.example .env     # then fill in real values (see below)
npm run dev               # starts on PORT (default 5001) with nodemon
```

Create the first admin account (there is no API route that can create one — see [Roles & permissions](#roles--permissions)):

```bash
npm run seed:admin
```

This reads `ADMIN_FIRST_NAME` / `ADMIN_LAST_NAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env` and creates (or no-ops if it already exists) a single admin user.

Run the test suite (needs a reachable MongoDB — see `MONGO_TEST_URI` below):

```bash
npm test
npm run lint
```

## Environment variables

See `.env.example` for the full list with placeholder values. Never commit a real `.env`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | no (default `development`) | `development` \| `test` \| `production`; gates error-message/stack verbosity |
| `PORT` | no (default `5001`) | HTTP port |
| `MONGO_URI` | **yes** | MongoDB connection string |
| `MONGO_TEST_URI` | no | Overrides the DB used by `npm test` per test file (falls back to a local `..._test_<name>` database) |
| `CORS_ORIGIN` | **yes** | The single frontend origin allowed to call this API — never a wildcard |
| `BODY_LIMIT` | no (default `100kb`) | Max JSON/urlencoded request body size |
| `JWT_SECRET` | **yes**, min 16 chars | HMAC secret used to sign/verify auth tokens |
| `JWT_EXPIRES_IN` | no (default `1h`) | Token lifetime (e.g. `1h`, `7d`) |
| `AUTH_RATE_LIMIT_WINDOW_MS` | no (default `900000`) | Rate-limit window for `/register` and `/login` |
| `AUTH_RATE_LIMIT_MAX` | no (default `20`) | Max attempts per window per IP on those two routes |
| `ADMIN_FIRST_NAME` / `ADMIN_LAST_NAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | only for `seed:admin` | Used exclusively by the seed script, never read by the running server |

Startup fails fast (with a clear message, no server listening) if a required variable is missing or invalid — see `src/config/env.js`.

## Authentication

Every protected route expects:

```
Authorization: Bearer <token>
```

`token` is the JWT returned from `POST /api/auth/login` (also returned from `GET /api/auth/me`'s underlying session, not re-issued there). It encodes `{ userId, role }` and expires per `JWT_EXPIRES_IN`. A missing, malformed, expired token, or a token for a user that no longer exists all fail the same way: `401 Unauthorized`.

## Roles & permissions

| Capability | `user` | `admin` |
| --- | --- | --- |
| Register / log in | ✅ | ✅ |
| CRUD their own notes | ✅ | ✅ |
| Read public posts, create a post | ✅ | ✅ |
| Read a given user's posts (public) | ✅ | ✅ |
| List/create/update/delete **any** user | ❌ | ✅ |
| List **every** user's notes | ❌ | ✅ |
| View the grouped-by-interests breakdown | ❌ | ✅ |

There is **no API route that can create an admin.** `POST /api/auth/register` always forces `role: "user"` server-side, ignoring any `role` field sent by the client. The only way to get an admin account is `npm run seed:admin` or an existing admin promoting another user via `PATCH /api/admin/users/:id`.

## Response format

Every response is JSON with this envelope:

```jsonc
// success
{
  "success": true,
  "message": "Records retrieved successfully",
  "data": /* object | array | null */,
  "pagination": { "page": 1, "limit": 10, "total": 42, "totalPages": 5 } // list endpoints only
}

// error
{
  "success": false,
  "message": "Validation failed",
  "errors": [{ "field": "email", "message": "Invalid email address" }] // present on 400s only
}
```

In `production`, any `5xx` response's `message` is replaced with the generic `"Internal server error"` and never includes a stack trace, regardless of the underlying error. Outside production, a `5xx` body also includes `stack` for debugging.

## Pagination, search, sort

Every list endpoint accepts (as query parameters) whichever of these it documents below as supported:

| Param | Default | Notes |
| --- | --- | --- |
| `page` | `1` | 1-indexed |
| `limit` | `10` | capped at `100` regardless of what's requested |
| `search` | — | case-insensitive substring match, `$or`-ed across that endpoint's documented searchable fields |
| `sortBy` | `createdAt` | must be one of that endpoint's allow-listed fields — an arbitrary value is rejected with `400`, not silently ignored |
| `sortOrder` | `desc` | `asc` \| `desc` |

`total` and `totalPages` in the response always reflect the full matching set server-side; nothing is ever paginated or filtered in application memory.

## API reference

### Health

#### `GET /health`
No auth. Returns process/DB status; `200` if the database is connected, `503` otherwise.

```jsonc
{ "success": true, "data": { "status": "ok", "uptime": 123.4, "database": { "isConnected": true } } }
```

### Auth

#### `POST /api/auth/register`
No auth. Rate-limited. Always creates a `role: "user"` account.

```jsonc
// body
{ "firstName": "Ada", "lastName": "Lovelace", "email": "ada@example.com", "password": "Sup3rSecret!" }
```
`201` → the created user (no password field). `400` invalid input. `409` email already registered.

#### `POST /api/auth/login`
No auth. Rate-limited.

```jsonc
// body
{ "email": "ada@example.com", "password": "Sup3rSecret!" }
```
`200` → `{ "data": { "user": { ... }, "token": "<jwt>" } }`. `401` for a wrong password **or** an unknown email — same generic message either way, so login never reveals which emails are registered.

#### `GET /api/auth/me`
Auth required. Returns the current token's user (re-fetched from the DB, so a deleted user's old token correctly 401s instead of returning stale data). No body/query.

### Notes (authenticated, owner-scoped)

All routes below require auth and are scoped to the requesting user — another user's note ID returns `404`, never `403`, so existence isn't leaked either.

#### `GET /api/notes`
Query: `page`, `limit`, `search` (title/content), `sortBy` (`title` \| `createdAt`), `sortOrder`.
`200` → the caller's notes + `pagination`.

#### `POST /api/notes`
```jsonc
// body
{ "title": "Shopping list", "content": "milk, eggs" } // content is optional, defaults to ""
```
`title` is required, trimmed, max 150 chars. `201` → the created note.

#### `GET /api/notes/:id`
`200` → the note if owned by the caller. `404` if it doesn't exist or belongs to someone else. `400` for a malformed id.

#### `PATCH /api/notes/:id`
```jsonc
// body — at least one field required
{ "title": "New title", "content": "" }
```
`title`, if present, cannot be emptied (min 1 char) and is capped at 150 chars; `content` may be cleared to `""`. `200` → the updated note. `404` if not owned/found.

#### `DELETE /api/notes/:id`
`200` on success, `404` if not owned/found.

### Posts (public read, authenticated write)

Posts are a separate collection, readable by anyone; only creation requires auth. There is no edit or delete endpoint for posts — by design, not an oversight.

#### `GET /api/posts`
No auth. Query: `page`, `limit`, `search` (title/content), `sortBy` (`title` \| `createdAt`), `sortOrder`.
`200` → posts from every user + `pagination`. Each post includes its raw `userId` (no author details are joined in this endpoint — see [User posts](#user-posts-aggregation) for that).

#### `POST /api/posts`
Auth required. `userId` is always taken from the authenticated token — a `userId` field in the body is accepted and silently ignored (ownership can never be spoofed).
```jsonc
// body
{ "title": "My first post", "content": "Hello, world." }
```
Both fields required; `title` capped at 150 chars. `201` → the created post.

### User posts (aggregation)

#### `GET /api/users/:userId/posts`
No auth (public). Query: `page`, `limit` (no search/sort — this is a fixed, newest-first per-user view).

Retrieves a user's public profile summary and their posts **in a single `User.aggregate()` call using `$lookup`** — no `populate()`, no second Posts query, no separate count query; pagination and the total post count are computed inside the same pipeline via a nested `$facet`.

`200`:
```jsonc
{
  "data": {
    "user": { "_id": "...", "firstName": "Ada", "lastName": "Lovelace", "email": "ada@example.com", "role": "user" },
    "posts": [{ "_id": "...", "title": "...", "content": "...", "createdAt": "..." }]
  },
  "pagination": { "page": 1, "limit": 10, "total": 3, "totalPages": 1 }
}
```
`400` for a malformed `userId`. `404` if the user doesn't exist.

### Admin — Users

All routes below require auth **and** `role: "admin"` — a normal user gets `403` on every one of them.

#### `GET /api/admin/users`
Query: `page`, `limit`, `search` (firstName/lastName/email, independently — not the concatenated display name), `role` (`user` \| `admin`), `sortBy` (`firstName` \| `lastName` \| `email` \| `createdAt`), `sortOrder`.
`200` → users (no password field) + `pagination`.

#### `POST /api/admin/users`
```jsonc
// body
{
  "firstName": "Grace", "lastName": "Hopper", "email": "grace@example.com",
  "password": "Sup3rSecret!", "role": "user", "interests": ["compilers"]
}
```
`role` defaults to `"user"`; `interests` defaults to `[]`. `201` → the created user.

#### `GET /api/admin/users/:id`
`200` → the user. `404` if not found.

#### `PATCH /api/admin/users/:id`
```jsonc
// body — at least one field required, no password field (no reset-password flow)
{ "role": "admin" }
```
Demoting the last remaining admin to `user` is rejected with `409`. `200` → the updated user. `404` if not found.

#### `DELETE /api/admin/users/:id`
An admin cannot delete their **own** account (`403`), and the **last remaining admin** cannot be deleted at all (`409`), even by a different admin. `200` on success, `404` if not found.

### Admin — Notes

#### `GET /api/admin/notes`
Auth + admin only. Query: `page`, `limit`, `search` (title/content), `sortBy` (`title` \| `createdAt`), `sortOrder`.

Every note across every user, each with an `owner` summary (`{ _id, firstName, lastName, email }`, or `null` if the owning user was since deleted — the key is always present so response shape stays consistent either way).

### Admin — Grouped interests (aggregation)

#### `GET /api/admin/users/grouped-by-interests`
Auth + admin only. Query: `page`, `limit` (no search/sort — groups are always returned alphabetically by interest).

Built from **exactly one `User.aggregate()` call** — no other Mongoose query method is used anywhere in this request path. Users with an empty/missing `interests` array are excluded from every group (the documented behavior for "no interests," not an invented "uncategorized" group); a user's own duplicate interest values are de-duplicated so they can never appear twice in one group. Pagination and the total group count are both computed inside the same pipeline via `$facet`.

`200`:
```jsonc
{
  "data": [
    {
      "interest": "chess",
      "users": [{ "_id": "...", "firstName": "Ada", "lastName": "Lovelace", "email": "...", "role": "user" }],
      "userCount": 1
    }
  ],
  "pagination": { "page": 1, "limit": 10, "total": 7, "totalPages": 1 }
}
```

## Indexing strategy

Every index in this codebase is declared explicitly via `schema.index()` (never implicit) and exists for one specific, named query — no index exists "just in case." See **[`docs/INDEX_STRATEGY.md`](docs/INDEX_STRATEGY.md)** for the full reasoning per model, plus `explain("executionStats")` evidence for the two aggregation scenarios and the global notes listing.

Summary:

| Model | Index | Serves |
| --- | --- | --- |
| `User` | `{ email: 1 }` unique | Login lookup + uniqueness |
| `User` | `{ createdAt: -1, _id: -1 }` | Admin user listing's default sort + stable pagination |
| `Note` | `{ userId: 1, createdAt: -1, _id: -1 }` | A user's own notes list, newest-first |
| `Note` | `{ createdAt: -1, _id: -1 }` | Admin's global notes listing (no `userId` filter, so the index above can't serve it) |
| `Post` | `{ userId: 1, createdAt: -1, _id: -1 }` | The `$lookup` sub-pipeline in the user-posts aggregation |
| `Post` | `{ createdAt: -1, _id: -1 }` | The public posts listing, newest-first |

Single-document lookups by `_id` (e.g. `GET /api/notes/:id`) rely on MongoDB's automatic, always-present `_id` index — no additional index is declared for them, since one would be redundant.

`search` is a case-insensitive regex `$or` across a small, fixed set of text fields on each resource; it is deliberately **not** backed by an index (a multi-field regex scan doesn't benefit from a simple B-tree index, and a `$text` index wasn't justified for this dataset shape/size) — this is a documented trade-off, not an oversight.

## Testing

```bash
npm test
```

Runs every file in `tests/` against a real MongoDB database (no mocking of Mongoose), covering: auth (registration/login/session edge cases), notes and posts CRUD + ownership, admin user management, both aggregation scenarios (including an explicit assertion that each uses exactly one `aggregate()` call), pagination/search/sort/filter behavior, index declarations per model (asserting the *exact* expected set, ruling out both missing and unnecessary indexes), rate limiting, and security headers/CORS/error-handling behavior.
