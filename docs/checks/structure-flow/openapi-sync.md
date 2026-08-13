# Check: openapi-sync

Purpose: grade issue 003 — documenting the 21 live routes missing from
`workerbackend/src/openapi.ts`'s `paths` map, plus a pure regression guard
that catches future drift the same way.

Spec: `docs/spec/structure-flow.md`, Implementation decisions, Seam 3.

Fix contract: a FAIL means the route list extracted from `index.ts`'s
`app.<method>('...')` calls is not fully a subset of
`Object.keys(openAPISpec.paths)` — the check prints the exact missing
path(s) by name; add each as an entry to `workerbackend/src/openapi.ts`'s
`paths` map, matching the file's existing hand-written style. Never edit
the check to shrink the live-path extraction or widen the subset test to
make a FAIL disappear.

## RUN

- RUN: `cd workerbackend && npx tsc --noEmit` -> exit:0
- RUN: `cd workerbackend && npx tsx openapi-check.ts` -> exit:0 match:"all passed"

## Judge-only notes (not graded by the runner)

- The check is string-level (regex over `index.ts`'s source text, `import`
  of `openAPISpec` from `openapi.ts`) — it never starts a server and never
  needs network or DB access.
- It asserts a subset relationship (live ⊆ documented), which is exactly
  the fix this issue makes — a builder cannot pass it by deleting live
  routes from `index.ts`, since this check never touches that file's
  content, only reads it.
- `git grep -c "kumule" -- docs/checks/structure-flow/openapi-sync.md`
  returns 0 — no repo-name collision risk in this check's patterns.

## Stress-test record (strategist pass, 2026-08-13)

`openapi-check.ts` does not exist yet on the base tree (this issue creates
it). Drafted and run against the current tree from an absolute-import copy:

```
$ cd workerbackend && npx tsx <draft-copy>.ts
live paths: 67, documented paths: 46
  FAIL 21 live route(s) missing from openapi.ts:
    /api/admin/escrow/resolve
    /api/admin/events/{id}
    /api/admin/evm/index
    /api/admin/evm/index-listings
    /api/admin/nfts/resolve-missing
    /api/admin/nfts/{assetId}/resolve
    /api/admin/r2/{folder}/{filename}
    /api/albums/{id}/tracks/{trackId}
    /api/albums/{id}/tracks/{trackId}/metadata
    /api/evm/index-listing
    /api/evm/index-token
    /api/nfts/{assetId}/like
    /api/nfts/{assetId}/liked
    /api/settle
    /api/solana/burn
    /api/solana/burn/confirm
    /api/solana/listing/sync
    /api/upload/files
    /cdn/images/{filename}
    /cdn/metadata/{filename}
    /openapi.json

1 FAILED
$ echo $?
1
```

Fails now with exactly the 21 paths this issue's acceptance criteria list —
proving the check is falsifiable and matches the spec's corrected finding,
not a rubber stamp. `npx tsc --noEmit` in `workerbackend` currently exits 0.
