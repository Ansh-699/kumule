# Check: medals-correctness

Purpose: grade issue 005 — the correctness sweep of `workerbackend/src/medals.ts`.
This pass's own reading found no bug beyond the already-ruled-out
`walletAddress` signature gap (R2 — explicitly out of scope; see the issue).
This check grades that the file still compiles and that the existing pinned
assertions for its two pure functions still hold, whatever the builder
changes or leaves alone.

Spec: `docs/spec/structure-flow.md`, Implementation decisions, Slice family 5.

Fix contract: a FAIL on `tsc` means a type error was introduced — fix
`workerbackend/src/medals.ts`. A FAIL on `security-check.ts` means
`validateTierConfig` or `medalStatus`'s behavior changed in a way that
breaks one of its existing pinned cases (tier-inversion rejection, claim
eligibility boundaries, supply-exhaustion) — these are exported pure
functions this run's acceptance criteria never license changing the
contract of; revert to matching the existing pinned behavior unless the job
report explicitly justifies and documents a contract change.

## RUN

- RUN: `cd workerbackend && npx tsc --noEmit` -> exit:0
- RUN: `cd workerbackend && npx tsx security-check.ts` -> exit:0 match:"all passed"

## Judge-only notes (not graded by the runner)

- Confirm the job report explicitly states whether `joinEvent`/`claimMedal`'s
  wallet-address handling was left untouched (required — see issue 005's
  boundary section) or, if changed, why the boundary was overridden.
- If a genuine bug fix was made and it is pure logic, a builder may extend
  `security-check.ts` with a new pinned case rather than only relying on
  this check's two RUN items — that is encouraged, not required.

## Stress-test record (strategist pass, 2026-08-13)

```
$ cd workerbackend && npx tsc --noEmit; echo $?
0
$ cd workerbackend && npx tsx security-check.ts; echo $?
... (35 pinned cases, all "ok")
all passed
0
```

Both currently pass (baseline). This check has no currently-failing item
because this pass's investigation of `medals.ts` found no fixable bug
beyond the explicitly-out-of-scope R2 finding — the check exists to prevent
regression during whatever the builder's own investigation turns up, per
the check-idiom's guidance that a review-only slice with no seeded pure-logic
fix is graded on the pure part plus the closing review.
