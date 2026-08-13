# Check: escrow-rpc-dedup

Purpose: grade issue 001 — collapsing eight independent RPC-fallback retry
blocks and seven positional `getIDL().instructions[N]` reads in
`workerbackend/src/escrow.ts` into one shared retry adapter and one named
discriminator table, with `syncListing` gaining the fallback it currently
lacks.

Spec: `docs/spec/structure-flow.md`, Implementation decisions, Seam 1.

Fix contract: a FAIL on the `tsc` item means a call site was left
referencing the old `getIDL().instructions[N]` shape incorrectly, or a type
error was introduced in the refactor — fix `workerbackend/src/escrow.ts`. A
FAIL on the discriminator item means either the new
`INSTRUCTION_DISCRIMINATORS` export is missing/misnamed, has the wrong key
set, or a byte value drifted from what `getIDL()` produces today — fix
`workerbackend/escrow-check.ts`'s import or `escrow.ts`'s constant, never
the expected literals in the check itself (they are pinned ground truth
from `escrow.ts` lines 87-160 as read 2026-08-13, not a moving target).

## RUN

- RUN: `cd workerbackend && npx tsc --noEmit` -> exit:0
- RUN: `cd workerbackend && npx tsx escrow-check.ts` -> exit:0 match:"all passed"

## Judge-only notes (not graded by the runner)

- Confirm no other file in the repo imports `INSTRUCTION_DISCRIMINATORS` —
  this issue's interface contract states no consumer exists yet
  (`git grep -l INSTRUCTION_DISCRIMINATORS -- '*.ts'` should show only
  `escrow.ts` and `escrow-check.ts`).
- Confirm `syncListing` now routes its RPC call through the shared retry
  adapter — grep `escrow.ts` for `syncListing` and check it calls the new
  adapter rather than a bare `connection.getAccountInfo`.
- Behavior against the live escrow program is out of scope for this check;
  it is confirmed only by the orchestrator's closing `api-test.mjs` pass.

## Stress-test record (strategist pass, 2026-08-13)

`escrow-check.ts` does not exist yet on the base tree (this issue creates
it). Drafted and run from an absolute-import copy against the current tree
to confirm the check design is falsifiable before freezing:

```
$ cd workerbackend && npx tsx <draft-copy-importing-src/escrow-by-absolute-path>.ts
TypeError: Cannot convert undefined or null to object
    at Object.keys (<anonymous>)
Node.js v24.10.0
$ echo $?
1
```

Fails now because `INSTRUCTION_DISCRIMINATORS` does not exist on the base
tree — the correct current state. The expected byte values embedded in the
check were read directly from `escrow.ts` lines 87-160 (`getIDL()`'s inline
literal), not recomputed, so the check cannot pass by accident from a
tautology.

`npx tsc --noEmit` in `workerbackend` currently exits 0 on the base tree
(confirmed 2026-08-13).
