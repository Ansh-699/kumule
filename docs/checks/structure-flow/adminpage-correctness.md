# Check: adminpage-correctness

Purpose: grade issue 012 — fixing `frontend/src/pages/AdminPage.tsx`'s
`EventsTab` to route its public-events fetch through `lib/api.ts`'s
`API_BASE`/error-handling pattern instead of a duplicated, unchecked raw
`fetch(...).json()` call.

Spec: `docs/spec/structure-flow.md`, Implementation decisions, Slice family 5.

Fix contract: a FAIL on either graded item means a type error or a build
break was introduced — fix `frontend/src/pages/AdminPage.tsx`. There is no
mechanical check for the `.ok`-check/error-surfacing fix itself (it needs a
running network stack to observe a failed fetch); that half is graded by
the closing review reading the diff, per the fix-contract note below.

## RUN

- RUN: `cd frontend && npx tsc --noEmit` -> exit:0
- RUN: `cd frontend && npm run build` -> exit:0

## Judge-only notes (not graded by the runner)

- Confirm `EventsTab`'s query function now checks `res.ok` (or equivalent)
  before parsing JSON, and that a failed fetch surfaces an error state to
  the admin rather than rendering as an empty "No events yet" — read the
  diff, this is not mechanically testable without a live network stack.
- Confirm the fix did not edit `frontend/src/lib/api.ts` (out of this
  issue's boundary) unless the job report explicitly justifies why a new
  export was unavoidable there.

## Stress-test record (strategist pass, 2026-08-13)

```
$ cd frontend && npx tsc --noEmit; echo $?
0
$ cd frontend && npm run build; echo $?
0
```

Both currently pass (baseline). No mechanically-failing item exists for
this check's core fix (the missing `.ok` check) because it is only
observable against live network behavior — per the check-idiom, this issue
is graded on the pure/build part plus the closing review reading the diff.
