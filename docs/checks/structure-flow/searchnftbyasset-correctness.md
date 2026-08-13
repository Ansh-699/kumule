# Check: searchnftbyasset-correctness

Purpose: grade issue 009 — fixing `workerbackend/src/searchnftbyasset.ts`'s
`asset` query-param validation to use `isSolanaAddress()` instead of a bare
`.length` check, so a malformed address returns a clean 400 instead of
falling through to a raw 500 about `SOLANA_RPC_URL`.

Spec: `docs/spec/structure-flow.md`, Implementation decisions, Slice family 5.

Fix contract: a FAIL means a same-length, base58-illegal `asset` value
still passes validation and reaches the `SOLANA_RPC_URL` check instead of
being rejected at 400 — fix `workerbackend/src/searchnftbyasset.ts` to
import and call `isSolanaAddress` from `./chains`.

## RUN

- RUN: `cd workerbackend && npx tsc --noEmit` -> exit:0
- RUN: `cd workerbackend && npx tsx searchnftbyasset-check.ts` -> exit:0 match:"all passed"

## Judge-only notes (not graded by the runner)

- Same probe string as issue 007/009's sibling checks
  (`0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl`, 32 chars, base58-illegal) — chosen to
  pass the old length-only check and fail the new one.
- No network access is required; `SOLANA_RPC_URL` is intentionally left
  unset in the check's environment so the current bug's exact failure mode
  (falling through to the RPC-not-configured 500) is what the check
  observes on the unfixed tree.

## Stress-test record (strategist pass, 2026-08-13)

`searchnftbyasset-check.ts` does not exist yet on the base tree (this issue
creates it). Drafted and run against the current tree from an
absolute-import copy:

```
$ cd workerbackend && npx tsx <draft-copy>.ts
  FAIL non-base58 asset rejected with 400, not a raw RPC-config 500 -> 500 (expected 400): {"error":"SOLANA_RPC_URL not configured"}
1 FAILED
$ echo $?
1
```

Fails now for exactly the reason the issue names. `npx tsc --noEmit` in
`workerbackend` currently exits 0.
