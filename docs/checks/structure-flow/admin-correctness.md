# Check: admin-correctness

Purpose: grade issue 011 — the correctness sweep of `workerbackend/src/admin.ts`
(the remaining, previously-unreviewed handlers: overview, users, listings,
transactions, hide/broken/resolve NFT metadata, EVM indexing, R2
object-replace, and `adminAuth` itself). This pass's own reading found no
bug. This check grades that the file still compiles and that `adminAuth`'s
existing pinned behavior still holds, whatever the builder's investigation
turns up.

Spec: `docs/spec/structure-flow.md`, Implementation decisions, Slice family 5.

Fix contract: a FAIL on `tsc` means a type error was introduced — fix
`workerbackend/src/admin.ts`. A FAIL on `security-check.ts` means
`adminAuth`'s behavior regressed (a retired backdoor key works again, the
constant-time compare was replaced with `===`, or the no-key-configured
503 fail-closed behavior changed) — these are the exact regressions
`security-check.ts` was written to catch; revert whatever change broke it.

## RUN

- RUN: `cd workerbackend && npx tsc --noEmit` -> exit:0
- RUN: `cd workerbackend && npx tsx security-check.ts` -> exit:0 match:"all passed"

## Judge-only notes (not graded by the runner)

- If nothing was found (the expected outcome, matching this pass's own
  reading), confirm the job report says so explicitly with what was
  checked — in particular `replaceR2Object`'s filename allowlist regex and
  `adminAuth`'s constant-time compare, the two invariants named in issue
  011 as worth a second look.

## Stress-test record (strategist pass, 2026-08-13)

```
$ cd workerbackend && npx tsc --noEmit; echo $?
0
$ cd workerbackend && npx tsx security-check.ts; echo $?
0
```

Both currently pass (baseline). No currently-failing item exists for this
check because this pass's investigation of `admin.ts` found no bug to seed
one against.
