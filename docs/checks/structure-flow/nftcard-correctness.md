# Check: nftcard-correctness

Purpose: grade issue 015 — the correctness sweep of
`frontend/src/components/NftCard.tsx`, including the confirmed bug that the
dynamically-built `` `hover:${ui.glow}` `` class is purged from the
production CSS bundle (Tailwind's scanner cannot see a class assembled from
a runtime string interpolation).

Spec: `docs/spec/structure-flow.md`, Implementation decisions, Slice family 5.

Fix contract: a FAIL on either `tsc`/`build` item means a type error or
build break was introduced — fix `frontend/src/components/NftCard.tsx`. A
FAIL on the CSS-presence item means the hover-glow class is still absent
from the production bundle — the class name construction must become
static (e.g. a lookup object mapping each chain to a complete
`'hover:shadow-[...]'` string) so Tailwind's build-time scanner can see it;
do not "fix" this by editing the check's grep pattern.

## RUN

- RUN: `cd frontend && npx tsc --noEmit` -> exit:0
- RUN: `cd frontend && npm run build && grep -q "shadow-\[" dist/assets/*.css` -> exit:0

## Judge-only notes (not graded by the runner)

- This check confirms the glow class exists *somewhere* in the built CSS
  (any `shadow-[` arbitrary-value class); it does not confirm it is
  attached to the right chain or the right element. Read the diff to
  confirm the fix maps each chain to its own correct glow color
  (`rgba(20,241,149,...)` for Solana, `rgba(98,126,234,...)` for Ethereum,
  per `frontend/src/lib/chain-ui.ts`), not just that *a* `shadow-[` class
  survived the build.

## Stress-test record (strategist pass, 2026-08-13)

```
$ cd frontend && npx tsc --noEmit; echo $?
0
$ cd frontend && npm run build > /dev/null 2>&1 && grep -q "shadow-\[" dist/assets/*.css; echo $?
1
```

`tsc` passes (baseline). The CSS-presence check correctly fails today:
`grep -c "shadow-\[" dist/assets/*.css` returns exactly `0` against a real
production build run this pass (`dist/assets/index-DqaS_Wb2.css`,
62.99 kB) — the hover-glow effect genuinely does not exist in production on
the current tree, confirming the bug rather than merely suspecting it.
