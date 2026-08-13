# Check: searchnftbyowner-correctness

Purpose: grade issue 010 — fixing `workerbackend/src/searchnftbyowner.ts`'s
`owner` query-param validation to use `isSolanaAddress()` instead of a bare
`.length` check, so a malformed address returns a clean 400 instead of a
silent, empty `200 []`; and collapsing the file's duplicated primary/
fallback formatting logic into one local helper.

Spec: `docs/spec/structure-flow.md`, Implementation decisions, Slice family 5.

Fix contract: a FAIL on the check item means a same-length, base58-illegal
`owner` value still passes validation and produces a silent `200 []`
instead of being rejected at 400 — fix
`workerbackend/src/searchnftbyowner.ts` to import and call
`isSolanaAddress` from `./chains`. The local-helper deduplication has no
mechanical check (it does not change externally observable behavior); it is
graded by the closing review reading the diff.

## RUN

- RUN: `cd workerbackend && npx tsc --noEmit` -> exit:0
- RUN: `cd workerbackend && npx tsx searchnftbyowner-check.ts` -> exit:0 match:"all passed"

## Judge-only notes (not graded by the runner)

- Same probe string as the sibling checks in issues 007/009
  (`0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl`, 32 chars, base58-illegal).
- Confirm this issue did not import from `workerbackend/src/escrow.ts` —
  its own independent copy of the RPC-fallback retry pattern is explicitly
  out of scope for consolidation this run (see issue 010's boundary and the
  strategist's `RULING NEEDED`).
- Confirm the primary-path/fallback-path formatting duplication (originally
  lines ~77-101 and ~167-191) was actually collapsed, not merely relocated
  — read the diff; this is judge-only since it has no mechanical signal.

## Stress-test record (strategist pass, 2026-08-13)

`searchnftbyowner-check.ts` does not exist yet on the base tree (this issue
creates it). Drafted and run against the current tree from an
absolute-import copy:

```
$ cd workerbackend && npx tsx <draft-copy>.ts
  FAIL non-base58 owner rejected with 400, not a silent empty 200 -> 200 (expected 400): []
1 FAILED
$ echo $?
1
```

Fails now for exactly the reason the issue names — the current behavior is
a silent, misleading success, arguably worse than the raw-500 failure mode
in the sibling files. `npx tsc --noEmit` in `workerbackend` currently exits
0.
