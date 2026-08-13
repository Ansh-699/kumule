# Check: useumi-correctness

Purpose: grade issue 016 — removing the hardcoded Helius devnet API key from
`frontend/src/hooks/useUmi.ts`'s RPC-URL fallback.

Spec: `docs/spec/structure-flow.md`, Implementation decisions, Slice family 5.

Fix contract: a FAIL on the key-absence item means the literal API key
string is still present in `useUmi.ts` — remove it and fall back to
`https://api.devnet.solana.com` (the same public devnet RPC the backend
already uses) instead of a keyed provider endpoint.

## RUN

- RUN: `cd frontend && npx tsc --noEmit` -> exit:0
- RUN: `cd frontend && npm run build` -> exit:0
- RUN: `! grep -q "0d4faf3d-ecf9-4bfe-8073-405021570776" frontend/src/hooks/useUmi.ts` -> exit:0

## Judge-only notes (not graded by the runner)

- The grep pattern is the literal API key substring, chosen because it is a
  distinctive UUID-like value with zero collision risk elsewhere in the
  repo (verified this pass: the only two files containing it anywhere in
  the tree are `frontend/src/hooks/useUmi.ts` itself and
  `docs/spec/structure-flow.md`'s own citation of the finding — this check
  greps only the former).
- Confirm the fix did not simply move the key to a different fallback
  location in the same file (e.g. a differently-named constant still
  holding the same key) — the third RUN item greps the exact key string
  anywhere in the file, so that would already fail it, but read the diff to
  confirm the *replacement* value is a public, unkeyed RPC URL and not
  another credential.
- Confirm `irysUploader`'s `providerUrl` (also wired to `rpcUrl` in this
  file) still resolves to a valid Solana RPC URL after the fallback change.

## Stress-test record (strategist pass, 2026-08-13)

```
$ cd frontend && npx tsc --noEmit; echo $?
0
$ cd frontend && npm run build; echo $?
0
$ (! grep -q "0d4faf3d-ecf9-4bfe-8073-405021570776" frontend/src/hooks/useUmi.ts); echo $?
1
```

`tsc` and `build` pass (baseline, unaffected by the key's presence). The
key-absence check correctly fails today (run from the repo root, matching
the check-runner's `workdir`) — the key is still present in
`useUmi.ts:12` — and will pass once the literal string is removed from the
file. (Caught and fixed during this stress-test pass: an earlier draft used
the path `src/hooks/useUmi.ts` without the `frontend/` prefix, which — run
from the repo root — silently greps a nonexistent file and always exits 0
regardless of whether the key was removed. That draft would have been a
check that passes even with the work undone; verified the corrected path
actually fails now before freezing it here.)
