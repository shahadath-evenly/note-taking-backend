# Index Strategy

This document explains every explicit index declared with `schema.index()` in the
Mongoose models, the query it supports, and why it is not redundant. It will be
revisited with `explain("executionStats")` evidence once representative data and
the relevant list/read endpoints exist (planned index audit phase).

All models also have MongoDB's automatic `_id` index, which is never redeclared.

## User (`src/models/User.js`)

| Index | Supports | Why not redundant |
| --- | --- | --- |
| `{ email: 1 }`, `unique: true` | Exact-match email lookup during login; enforces one account per email. | Only index on `email`; required for both the lookup and the uniqueness constraint. |
| `{ createdAt: -1, _id: -1 }` | Admin user listing's default newest-first sort with a stable pagination tie-breaker. | Distinct key shape from the email index; not a prefix of it. |

No index is declared on `role` or `interests`:
- `role` is only ever filtered as an optional, low-cardinality equality filter on the admin user listing; it will be added later only if a measured, required query justifies it.
- `interests` is not indexed merely because the interest-grouping aggregation groups by it. That aggregation's `$unwind`/`$group` stages process the matched documents regardless of whether `interests` is indexed, so an index here would add write/storage cost without the grouping stages themselves becoming index-backed.

## Note (`src/models/Note.js`)

| Index | Supports | Why not redundant |
| --- | --- | --- |
| `{ userId: 1, createdAt: -1, _id: -1 }` | A user's own notes list: filtering by `userId` and sorting newest-first with a stable tie-breaker. Owner-scoped get/update/delete queries filter by `_id` + `userId`; the automatic `_id` index already serves the `_id` lookup, and this index is not needed for that single-document case. | Only compound index on this collection. |

**Deliberately omitted:** `{ createdAt: -1, _id: -1 }` for a potential admin
all-notes global listing. This index is not declared yet because the admin
all-notes endpoint (and its actual sort requirement) does not exist in this
phase — adding it now would be speculative. It should be added only if that
endpoint's chosen query and an `explain()` plan justify it when it is built.

## Post (`src/models/Post.js`)

| Index | Supports | Why not redundant |
| --- | --- | --- |
| `{ userId: 1, createdAt: -1, _id: -1 }` | The user-posts `$lookup` aggregation's per-user equality match (`posts.userId == user._id`) and newest-first ordering within that lookup. | No standalone `userId` index is declared — it would be redundant since this compound index already starts with `userId` and serves equality-only lookups on that field too. |
| `{ createdAt: -1, _id: -1 }` | The public posts listing, which the API contract requires to be newest-first with stable pagination. | Distinct key shape (no `userId` prefix); supports the global (non-owner-scoped) listing that the Post collection's first index cannot serve. |

## Summary of restrictions followed

- No duplicate `_id` indexes declared.
- No field-level `index: true` or `unique: true` shortcuts used for the reviewed indexes; all are declared explicitly via `schema.index()`.
- No index added purely because a field participates in `$group`/`$unwind`.
- No standalone index declared when an existing compound index's prefix already serves the same equality query.
