# Check: audit-correctness

Purpose: grade issue 008 — the correctness sweep of `workerbackend/src/audit.ts`.
This pass's own reading found no bug. This check grades that the file still
compiles, whatever the builder's investigation turns up.

Spec: `docs/spec/structure-flow.md`, Implementation decisions, Slice family 5.

Fix contract: a FAIL means a type error was introduced — fix
`workerbackend/src/audit.ts`.

## RUN

- RUN: `cd workerbackend && npx tsc --noEmit` -> exit:0

## Judge-only notes (not graded by the runner)

- If nothing was found (the expected outcome, matching this pass's own
  reading), confirm the job report says so explicitly with what was
  checked, per issue 008's acceptance criteria — an empty diff with no
  report explanation is not sufficient evidence the file was actually read.
- `createTransactionChecksum`/`verifyTransactionChecksum` have no comparable
  pure regression check today; adding one is optional, not required, since
  this pass found the existing behavior already correct (decimal-string
  amounts throughout, checksum recomputed rather than trusted from a stored
  flag).

## Stress-test record (strategist pass, 2026-08-13)

```
$ cd workerbackend && npx tsc --noEmit; echo $?
0
```

Currently passes (baseline). No currently-failing item exists for this
check because this pass's investigation of `audit.ts` found no bug to seed
one against.
