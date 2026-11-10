# Index Strategy

This document explains every explicit index declared with `schema.index()` in the
Mongoose models, the query it supports, and why it is not redundant.

All models also have MongoDB's automatic `_id` index, which is never redeclared.

A full audit (Phase 12, below the per-model tables) re-verified every entry in
this document against real query shapes with `explain("executionStats")`
after all backend endpoints were implemented.

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
| `{ createdAt: -1, _id: -1 }` | The public posts listing (`GET /api/posts`), which defaults to newest-first with stable pagination and no `userId` filter. | Distinct key shape (no `userId` prefix); supports the global (non-owner-scoped) listing that the Post collection's first index cannot serve. |

Both Post indexes were declared back in Phase 3, before either consuming
endpoint existed, anticipating this exact shape. Now that `GET /api/posts`
exists, `explain("executionStats")` on
`Post.find({}).sort({ createdAt: -1, _id: -1 }).limit(10)` confirms an
`IXSCAN` on `createdAt_-1__id_-1` with `totalDocsExamined: 10` (matching
`nReturned`) against 100 seeded posts — no new index was needed.

## Scenario 2 — User posts via `$lookup` (`GET /api/users/:userId/posts`)

Implemented in `src/repositories/user.repository.js#getUserWithPosts`. This is
the **only** Mongoose call made in that request path — one `User.aggregate(pipeline)`
call. A dedicated test spies on `User.aggregate` (asserting exactly one call
and that the pipeline contains a `$lookup` stage) and on every `Post` read
method (`find`, `findOne`, `distinct`, `countDocuments`,
`estimatedDocumentCount`, `populate`), asserting all of them stay at zero.

Pipeline, in order:
1. `$match: { _id: userId }` — matches the requested user first, as required.
   The `userId` route param is validated as a well-formed ObjectId *before*
   the pipeline is even built (returning 400 otherwise), and a pipeline that
   matches zero users (a well-formed but non-existent id) is distinguished
   from "found with zero posts" by the service layer, returning 404.
2. `$lookup` with `let`/`pipeline` (not the `localField`/`foreignField`
   shorthand) because the join needs to sort and paginate the matched posts,
   which the shorthand form cannot do on its own:
   - `$match: { $expr: { $eq: ['$userId', '$$userId'] } }` — equality match
     against the outer user's `_id`.
   - `$sort: { createdAt: -1, _id: -1 }` — newest-first with a stable
     tie-breaker.
   - `$facet` — paginates the matched posts in `data` and computes
     `totalCount` in the same sub-pipeline, so no separate count query is
     ever made.
3. `$unwind` the single-element `$lookup` array (the nested `$facet` always
   produces exactly one document) and `$project` only a safe user field list
   (`_id`, `firstName`, `lastName`, `email`, `role` — no `password`), with
   `posts` and `totalPosts` pulled out of the lookup result.

### Index behavior (evidence)

Ran `explain("executionStats")` on this exact pipeline against 250 seeded
posts (50 belonging to the target user, 200 belonging to another user):

- The initial `$match` on `User._id` resolves via `"stage": "IDHACK"` —
  MongoDB's fast path for an exact `_id` match — `totalKeysExamined: 1`,
  `totalDocsExamined: 1`.
- The `$lookup` stage reports `"indexesUsed": ["userId_1_createdAt_-1__id_-1"]`,
  `"collectionScans": 0`, `"totalDocsExamined": 50`, `"totalKeysExamined": 50`
  — exactly the 50 posts belonging to the matched user, not all 250 in the
  collection. The compound index serves both the equality match on `userId`
  and the sort on `createdAt`/`_id` within the lookup, with zero collection
  scans.

No additional index was added for this scenario — the existing Post compound
index (declared for this exact purpose back when the model was created) is
sufficient, confirmed by this evidence.

## Phase 12 — full index audit

A dedicated audit pass across every Mongoose schema and every list/read/aggregation
query in the codebase, performed after all backend endpoints existed. It
re-verifies every claim made in the sections above against real query shapes
and adds a few that weren't yet covered individually.

### Method

1. Listed every `schema.index()` declaration (6 total: 2 on `User`, 2 on
   `Note`, 2 on `Post`).
2. Grepped every Mongoose call site across `src/repositories/`, `src/services/`,
   and the two aggregation pipelines, and matched each one against the
   filter/sort shape it actually issues at runtime.
3. Seeded a scratch database (60 users, 300 notes, 300 posts — dropped
   afterward) and ran `explain("executionStats")` for every one of those
   shapes, including the non-default `sortBy` options the admin/public list
   endpoints accept.

### Results

| # | Query (real call site) | Index used | Docs examined / returned | Collection scan? |
| - | --- | --- | --- | --- |
| 1 | User list, default sort (`createdAt` desc) | `createdAt_-1__id_-1` | 10 / 10 | No |
| 2 | User list, `role` filter, default sort | `createdAt_-1__id_-1` (full index walk; `role` filtered in `FETCH`) | 60 / 6 | No — but touches nearly every doc anyway |
| 3 | User list, `sortBy=email` | none — `SORT` + `COLLSCAN` | 60 / 10 | **Yes** |
| 4 | User list, `sortBy=firstName`/`lastName` | none — `SORT` + `COLLSCAN` | 60 / 10 | **Yes** |
| 5 | User list, search (firstName/lastName/email) | `createdAt_-1__id_-1` (sort order); regex filtered in `FETCH` | 50 / 10 | No |
| 6 | `User.findOne({ email })` — login | `email_1` | 1 / 1 | No |
| 7 | `User.findById(id)` — get/update/delete one user, `/me` | automatic `_id` (`IDHACK`) | 1 / 1 | No |
| 8 | `User.find({ role, _id: { $ne } })` — last-admin guard | `createdAt_-1__id_-1` (full index walk) | 59 / 5 | No — same caveat as #2 |
| 9 | Note list, `userId` filter, default sort — a user's own notes | `userId_1_createdAt_-1__id_-1` | 5 / 5 | No |
| 10 | Note list, `userId` filter, `sortBy=title` | `userId_1_createdAt_-1__id_-1` (filters via index; sorts in memory) | 5 / 5 | No |
| 11 | Note list, no filter, default sort — admin global notes | `createdAt_-1__id_-1` | 10 / 10 | No |
| 12 | Note list, no filter, search — admin global notes | `createdAt_-1__id_-1` (sort order); regex filtered in `FETCH` | 10 / 10 | No |
| 13 | Note list, no filter, `sortBy=title` — admin global notes | none — `SORT` + `COLLSCAN` | 300 / 10 | **Yes** |
| 14 | `Note.findOne({ _id, userId })` — single owner-scoped note | automatic `_id` | 1 / 1 | No |
| 15 | Post list, no filter, default sort — public posts | `createdAt_-1__id_-1` | 10 / 10 | No |
| 16 | Post list, no filter, search — public posts | `createdAt_-1__id_-1` (sort order); regex filtered in `FETCH` | 50 / 10 | No |
| 17 | Post list, no filter, `sortBy=title` — public posts | none — `SORT` + `COLLSCAN` | 300 / 10 | **Yes** |
| 18 | `Post.find({ userId })` sorted newest-first — Scenario 2 sub-pipeline shape | `userId_1_createdAt_-1__id_-1` | 5 / 5 | No |
| 19 | Scenario 1 interest-grouping `$match` | none, by design (see "Scenario 1" above) | 100 / 100 | Yes — expected and already documented above |

### Findings

- **No index was added, removed, or changed as a result of this audit.** Every
  existing index maps to at least one real, currently-implemented query, and
  no index was found to be redundant or unjustified.
- Rows 3, 4, 13, 17 — sorting by a non-default, non-indexed field
  (`email`/`firstName`/`lastName` on `User`, `title` on `Note`/`Post`) — do a
  full collection scan. This is a deliberate trade-off, not an oversight:
  these are optional, occasional sort choices on list endpoints, and indexing
  every sortable column would violate "do not index every field" for little
  real benefit. Diagnostic detail on row 3: sorting by `{ email: 1 }` *alone*
  does use the unique `email_1` index — the collection scan only happens
  because `parseSort` always appends `_id` as a stable tie-breaker, and the
  resulting two-key sort `{ email: 1, _id: 1 }` doesn't match the single-key
  `email_1` index's shape. Adding a second index `{ email: 1, _id: 1 }` purely
  to cover this one optional sort was considered and rejected for the same
  reason as rows 3/4/13/17 — it would be speculative indexing for an
  infrequent, non-default option.
- Rows 2 and 8 (`role` filter; the last-admin count) use a full **index**
  walk rather than a collection scan, but still touch nearly every document —
  functionally no better than a collection scan here. This reinforces the
  Phase 6 decision not to index `role`: it's low-cardinality, used only as an
  optional filter and in an infrequent safety check, not a primary access
  pattern that would justify the extra write/storage cost.
- Row 10 vs. row 13 is an instructive contrast: both sort by the unindexed
  `title` field, but row 10 (a user's own notes) still only examines 5
  documents, because the `userId` prefix of the owner-scoped compound index
  narrows the candidate set before the in-memory sort. Row 13 (the admin
  global listing) has no equality filter to exploit that way, so it falls
  back to a full collection scan over all 300 notes.
- Both required aggregation scenarios were re-confirmed, during this audit, to
  still use exactly one `aggregate()` call each and to remain correctly
  documented above — nothing changed for either of them in this phase.

### Test-infrastructure finding (fixed during this audit)

While re-running the full regression suite repeatedly to confirm the audit
made no behavioral changes, one run showed a test expecting `409` (duplicate
email) get `201` instead — a rare, real flake, not a one-off fluke. The cause
was directly related to this audit's subject matter: `mongoose.connect()`
resolves before each model's indexes finish building in the background,
including the unique `email` index. On a fresh, just-created scratch test
database, a duplicate-email test running early enough could occasionally
insert before that uniqueness constraint was actually active yet. Every test
file that connects to a database now explicitly `await`s
`Model.createIndexes()` for its imported models right after `connect()`,
closing that window. The full suite was then run 10 consecutive times with
zero failures (previously ~1-in-6 showed this flake).

### Critical rules re-confirmed

- All 6 intentional indexes are declared via `schema.index()` — none via
  field-level `index: true`/`unique: true` shortcuts.
- No index duplicates the automatic `_id` index.
- No standalone index duplicates a compound index's prefix (e.g. no bare
  `{ userId: 1 }` on `Note` or `Post`).
- No index exists on `interests` merely for `$unwind`/`$group`.
- Not every field is indexed — `role`, `firstName`, `lastName`, `title`,
  `content`, and `interests` all remain unindexed, each for a documented
  reason above.

## Summary of restrictions followed

- No duplicate `_id` indexes declared.
- No field-level `index: true` or `unique: true` shortcuts used for the reviewed indexes; all are declared explicitly via `schema.index()`.
- No index added purely because a field participates in `$group`/`$unwind`.
- No standalone index declared when an existing compound index's prefix already serves the same equality query.
