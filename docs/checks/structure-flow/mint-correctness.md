# Check: mint-correctness

Purpose: grade issue 007 — fixing `workerbackend/src/mint.ts`'s `owner`/
`collection` validation to use the shared `isSolanaAddress()` validator
instead of a bare `.length` check, so a malformed address returns a clean
400 instead of a raw 500 leaking an `InvalidPublicKeyError` message.

Spec: `docs/spec/structure-flow.md`, Implementation decisions, Slice family 5.

Fix contract: a FAIL on the check item means a same-length,
base58-illegal `owner` still reaches `publicKey(owner)` and crashes with a
raw 500 instead of being rejected at 400 — `mint.ts` still validates by
length alone. Fix `workerbackend/src/mint.ts` to import and call
`isSolanaAddress` from `./chains`, never edit the check's probe address to
make it pass.

## RUN

- RUN: `cd workerbackend && npx tsc --noEmit` -> exit:0
- RUN: `cd workerbackend && npx tsx mint-check.ts` -> exit:0 match:"all passed"

## Judge-only notes (not graded by the runner)

- The probe address `0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl` is 32 characters
  (inside the `.length` check's accepted 32-44 window) and contains only
  base58-illegal characters (`0`, `O`, `I`, `l`) — it is chosen specifically
  to pass the old check and fail the new one; do not treat a check that
  only tests this one string as covering every malformed-input shape, but
  it is sufficient to prove the validator was actually swapped, not merely
  reordered.
- No network or DB access is needed — the fix must reject before any RPC
  call, so the check runs fully offline.

## Stress-test record (strategist pass, 2026-08-13)

`mint-check.ts` does not exist yet on the base tree (this issue creates
it). Drafted and run against the current tree from an absolute-import copy:

```
$ cd workerbackend && npx tsx <draft-copy>.ts
  FAIL non-base58 owner rejected with 400, not a raw 500 -> 500 (expected 400): Mint failed: InvalidPublicKeyError: The provided public key is invalid: 0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl. Public keys must be base58 encoded.
1 FAILED
$ echo $?
1
```

Fails now with exactly the raw 500 the issue names — a real, currently
broken, falsifiable check. `npx tsc --noEmit` in `workerbackend` currently
exits 0.
