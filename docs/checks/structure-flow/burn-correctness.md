# Check: burn-correctness

Purpose: grade issue 006 — the correctness sweep of `workerbackend/src/burn.ts`.
This pass's own reading found one observation (the signature-specificity
gap in `confirmBurn`, see the issue) but no proven exploitable bug. This
check grades that the file still compiles, whatever the builder's
investigation turns up.

Spec: `docs/spec/structure-flow.md`, Implementation decisions, Slice family 5.

Fix contract: a FAIL means a type error was introduced by whatever change
was made — fix `workerbackend/src/burn.ts`.

## RUN

- RUN: `cd workerbackend && npx tsc --noEmit` -> exit:0

## Judge-only notes (not graded by the runner)

- Confirm the job report states a decision on the signature-specificity
  observation from issue 006 (fixed, or left as a documented limitation
  with reasoning) — silence on it is a job-report defect even if `tsc`
  passes.
- `burnNft`/`confirmBurn` have no pure, network-free logic comparable to
  `mint.ts`/`searchnftbyasset.ts`/`searchnftbyowner.ts`'s address-validation
  bug (their one weak point, ownership comparison, needs a real `Nft` row
  and is not testable without a DB) — no pure regression check is required
  here per the check-idiom's guidance for slices whose behavior only shows
  up against live chain/DB state.

## Stress-test record (strategist pass, 2026-08-13)

```
$ cd workerbackend && npx tsc --noEmit; echo $?
0
```

Currently passes (baseline). No currently-failing item exists for this
check because this pass's investigation of `burn.ts` did not surface a
pure-logic bug distinct from what needs live chain/DB state to observe.
