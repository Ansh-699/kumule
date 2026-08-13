# Check: walletbutton-correctness

Purpose: grade issue 013 — the correctness sweep of
`frontend/src/components/WalletButton.tsx`. This pass's own reading found
no bug. This check grades that the file still compiles and builds, whatever
the builder's investigation turns up.

Spec: `docs/spec/structure-flow.md`, Implementation decisions, Slice family 5.

Fix contract: a FAIL means a type error or build break was introduced — fix
`frontend/src/components/WalletButton.tsx`.

## RUN

- RUN: `cd frontend && npx tsc --noEmit` -> exit:0
- RUN: `cd frontend && npm run build` -> exit:0

## Judge-only notes (not graded by the runner)

- If nothing was found (the expected outcome, matching this pass's own
  reading), confirm the job report says so explicitly with what was
  checked.

## Stress-test record (strategist pass, 2026-08-13)

```
$ cd frontend && npx tsc --noEmit; echo $?
0
$ cd frontend && npm run build; echo $?
0
```

Both currently pass (baseline). No currently-failing item exists for this
check because this pass's investigation of `WalletButton.tsx` found no bug
to seed one against.
