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
- `interests` is not indexed merely because the interest-grouping aggregation groups by it. See "Scenario 1" below for the concrete evidence.

## Scenario 1 — Group users by interests (`GET /api/admin/users/grouped-by-interests`)

Implemented in `src/repositories/user.repository.js#groupByInterests`. This is
the **only** Mongoose call made in that request path — one `User.aggregate(pipeline)`
call, with pagination and the total group count computed inside the same
pipeline via `$facet` (no separate count query, no `find`/`distinct`/`populate`
call). This invariant is enforced by a dedicated test that monkey-patches
`User.aggregate`, `find`, `findOne`, `distinct`, `countDocuments`,
`estimatedDocumentCount`, and `populate` to assert their call counts.

Pipeline, in order:
1. `$addFields: { interests: { $setUnion: ['$interests', []] } }` — de-duplicates
   each user's own interests array (e.g. `["chess","chess"]` → `["chess"]`) so a
   repeated interest value can never make a user appear twice within one group
   after `$unwind`.
2. `$match: { 'interests.0': { $exists: true } }` — excludes users with an empty
   (or missing) interests array from every group. This is the documented default
   for empty interests, chosen over inventing an "uncategorized" group, since the
   assessment's fallback of "omit them" keeps the grouped view focused on actual
   interest clusters.
3. `$unwind: '$interests'` — one document per (user, interest) pair.
4. `$group` by interest, pushing only an explicit safe field list per user
   (`_id`, `firstName`, `lastName`, `email`, `role`) — a password hash can never
   reach the output even if the `User` schema gains new sensitive fields later,
   because this is an inclusion list, not an exclusion list.
5. `$project` / `$sort: { interest: 1 }` — stable, deterministic alphabetical
   order (the grouped interest name is unique after `$group`, so no further
   tie-breaker is needed).
6. `$facet` — paginates the **groups** (not the users within a group, per the
   assessment's stated preference for a grouped-by-interest screen) in `data`,
   and computes `totalCount` in the same pass.

### Index behavior (evidence)

No index exists on `interests`, by design. Running
`User.aggregate(pipeline).explain('executionStats')` against 100 seeded users
(a mix of 1-interest users and users with an empty `interests` array) shows:

```json
{
  "stage": "COLLSCAN",
  "nReturned": 100,
  "docsExamined": 100
}
```

wrapped in a `$cursor` stage with `totalKeysExamined: 0` — the initial
`$addFields`/`$match` portion that MongoDB pushes down into the query layer
examines every document with a full collection scan, not an index scan.

This is expected, and an `interests` index would not change it, for two
reasons:
1. The `$match` in this pipeline filters on the **computed** `interests` field
   produced by the preceding `$addFields` ($setUnion-deduplicated), not on the
   stored schema path directly. A B-tree index on the stored `interests` array
   cannot be used to answer a query against a value MongoDB just computed one
   stage earlier in the same pipeline.
2. Even if the `$match` ran directly against the stored field, the subsequent
   `$unwind`/`$group` stages still have to process every matching document and
   every interest within it to build the per-interest user lists and counts —
   an index only helps *locate* documents, not perform that grouping work.

So the decision to omit an `interests` index is not just a general heuristic;
it is confirmed by explain output for this exact pipeline shape. If a future,
different query needed to filter users by a single known interest (e.g.
`User.find({ interests: 'chess' })`), that would be a different, justified
case for a multikey index on `interests` — but no such query exists yet.

## Note (`src/models/Note.js`)

| Index | Supports | Why not redundant |
| --- | --- | --- |
| `{ userId: 1, createdAt: -1, _id: -1 }` | A user's own notes list: filtering by `userId` and sorting newest-first with a stable tie-breaker. Owner-scoped get/update/delete queries filter by `_id` + `userId`; the automatic `_id` index already serves the `_id` lookup, and this index is not needed for that single-document case. | Only index with this prefix on this collection. |
| `{ createdAt: -1, _id: -1 }` | The admin global notes listing (`GET /api/admin/notes`), which has no `userId` filter (it intentionally returns every user's notes) and defaults to newest-first with a stable tie-breaker. | Distinct key shape — not a prefix of, and not served by, the `userId`-leading index above, because that index's leading key only helps queries that filter by `userId`. |

### Evidence for the admin global-notes index

This index was *not* added speculatively — Phase 7 deliberately omitted it
until the admin listing (and its real query shape) existed. With that query
now implemented, `Note.find({}).sort({ createdAt: -1, _id: -1 }).limit(10)`
was checked with `explain("executionStats")` against 300 seeded notes:

- **Without** the index: `{"stage":"SORT", "inputStage":{"stage":"COLLSCAN"}}` —
  `totalDocsExamined: 300`, `totalKeysExamined: 0`. Every note has to be
  scanned and sorted in memory just to return the first page, and this cost
  scales with the total number of notes regardless of page size.
- **With** the index: `{"stage":"LIMIT", "inputStage":{"stage":"FETCH", "inputStage":{"stage":"IXSCAN", ...}}}` —
  `totalDocsExamined: 10`, `totalKeysExamined: 10`. Only as many documents as
  are actually returned are touched.

When a search term is also supplied (`$or` regex on `title`/`content`), the
same index still serves the sort order, with the regex applied as a `FETCH`
filter afterward (`SUBPLAN` → `LIMIT` → `FETCH` with the `$or` filter →
`IXSCAN` on `createdAt`/`_id`). Documents still have to be examined until
enough regex matches accumulate — a regex `$or` search is never fully
index-selective — but the index still avoids the in-memory sort. No text
index was added for search, since that was not required and the existing
regex-based approach (consistent with the other list endpoints) is adequate
for this assessment's scale.

### Owner summary field

`GET /api/admin/notes` joins a safe owner summary (`firstName`, `lastName`,
`email`) via `.populate('userId', 'firstName lastName email')` — a regular
Mongoose query feature, not an aggregation `$lookup`; this endpoint has no
"single aggregate call" constraint (unlike the two required aggregation
scenarios). The explicit field list on `populate` means a password hash is
never fetched. No index is needed for this join: it resolves each note's
`userId` by the automatic `_id` index on `User`, one lookup per already-paginated
note (at most `limit` lookups per request, not per the whole collection).

Owner name/email are not supported as *search* fields — only `title`/`content`
are, as required — because filtering notes by an owner's name/email would
need either a `$lookup` aggregation or a two-step query (first resolve
matching user ids, then filter notes by them), and nothing in this phase's
scope required it.

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
