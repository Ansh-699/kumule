# Check: dead-code-removal

Purpose: grade issue 004 — deleting the dead v1 Anchor scaffolding at
`migrations/` and `tests/` (repo root) with nothing else in the repo
regressing.

Spec: `docs/spec/structure-flow.md`, Implementation decisions, Slice family 4.

Fix contract: a FAIL on the directory-existence item means one or both
directories are still present — delete them. A FAIL on either `tsc` item
means something unexpectedly imported from one of these directories (not
expected — grounding found zero references outside the directories
themselves) — if so, this is a decomposition defect, not a builder defect;
escalate rather than silently restoring the directory.

## RUN

- RUN: `test ! -d migrations && test ! -d tests` -> exit:0
- RUN: `cd workerbackend && npx tsc --noEmit` -> exit:0
- RUN: `cd frontend && npx tsc --noEmit` -> exit:0

## Judge-only notes (not graded by the runner)

- `programs/` is explicitly out of scope (frozen reference, not dead code,
  per its own README) — confirm the builder did not touch it.
- No new artifact paths are created by this issue, so no
  `git check-ignore` concern applies.

## Stress-test record (strategist pass, 2026-08-13)

```
$ (test ! -d migrations && test ! -d tests); echo $?
1
```

Correctly fails today — both directories still exist. Confirmed via
repo-wide grep (`find` scoped past `node_modules`, `migrations/`, `tests/`
themselves) that only `docs/spec/structure-flow.md`'s own prose references
either directory name; no `.sh`, `.json`, or `.md` file depends on them.

```
$ cd workerbackend && npx tsc --noEmit; echo $?
0
$ cd frontend && npx tsc --noEmit; echo $?
0
```

Both currently pass (baseline, unaffected by the directories' presence or
absence).
