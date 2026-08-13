# Check: auth-parity

Purpose: grade issue 002 — gating the six `album.ts` mutation routes and the
two `upload.ts` routes (`files`, `audio`) with `adminAuth` in `index.ts`'s
route table, while `upload/image` and `upload/metadata` stay public for the
mint flow.

Spec: `docs/spec/structure-flow.md`, Implementation decisions, Seam 2.

Fix contract: a FAIL on any `admin-gated` line means that route's
`app.<method>()` registration in `workerbackend/src/index.ts` is still
missing `adminAuth` as its second argument — add it, in the same position
every other admin-gated route already uses. A FAIL on either `public`
line means `adminAuth` was added to a route that must stay reachable by
`CreatePage.tsx`'s unauthenticated mint flow — remove it. Fix
`workerbackend/src/index.ts` only; this check never expects a handler-body
change in `album.ts`/`upload.ts`.

## RUN

- RUN: `cd workerbackend && npx tsc --noEmit` -> exit:0
- RUN: `cd workerbackend && npx tsx auth-parity-check.ts` -> exit:0 match:"all passed"
- RUN: `cd workerbackend && npx tsx security-check.ts` -> exit:0 match:"all passed"

## Judge-only notes (not graded by the runner)

- The check imports the real exported `app` from `index.ts` and asserts
  status codes with a wrong-but-configured `X-Admin-API-Key`, not a rebuilt
  toy router — it fails if `adminAuth` is wired to the wrong path, not just
  if it is entirely absent.
- Full authenticated round-trip confirmation (a *correct* key returning 200)
  is out of scope here — `ADMIN_API_KEY` is not available locally
  (precondition P8). That is confirmed only by the orchestrator's closing
  `api-test.mjs` pass against the live worker.

## Stress-test record (strategist pass, 2026-08-13)

`auth-parity-check.ts` does not exist yet on the base tree (this issue
creates it). Drafted and run against the current tree from an
absolute-import copy to confirm it correctly fails today:

```
$ cd workerbackend && npx tsx <draft-copy>.ts
admin-gated mutation routes (must be 401 with a wrong key):
  FAIL POST /api/albums -> 500 (expected gated=true)
  FAIL PUT /api/albums/:id -> 500 (expected gated=true)
  FAIL DELETE /api/albums/:id -> 500 (expected gated=true)
  FAIL POST /api/albums/:id/tracks -> 500 (expected gated=true)
  FAIL PUT /api/albums/:id/tracks/:trackId -> 500 (expected gated=true)
  FAIL DELETE /api/albums/:id/tracks/:trackId -> 500 (expected gated=true)
  FAIL POST /api/upload/files -> 400 (expected gated=true)
  FAIL POST /api/upload/audio -> 400 (expected gated=true)

public mint-flow upload routes (must stay reachable, never 401):
  ok   POST /api/upload/image -> 400
  ok   POST /api/upload/metadata -> 500

8 FAILED
$ echo $?
1
```

8 of 10 assertions correctly fail today (the eight routes that need gating
are not yet gated); the two that must stay public already correctly return
non-401. `npx tsx security-check.ts` currently exits 0, all passed
(confirmed 2026-08-13) — this is the regression guard, not a new assertion.
`npx tsc --noEmit` in `workerbackend` currently exits 0.
