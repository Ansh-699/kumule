# structure-flow

## Goal

Two audit rounds already closed the eight flow-breaking gaps that made
Kumule v2's mint-to-buy path incoherent (no settlement, unindexed EVM
activity, pre-chain DB writes, stale-commitment reads, an approval race, a
never-populated Collections table, an ignored `?collection=` param, and
unreachable hidden NFTs — all fixed, see `## Assumptions` for how this run
treats them). This run picks up where those left off: a correctness pass
over the parts of the codebase nobody has deeply read yet, plus the
structural cleanup that makes the escrow module, the auth surface, and the
API contract match what the rest of the code already assumes about them.

A reader landing on this repo after the run should find: every
content-mutation route gated the same way (no route is unauthenticated by
omission), one retry/discriminator seam in `escrow.ts` instead of six
copies of it, an OpenAPI doc that lists the routes that actually exist, no
dead v1 Anchor scaffolding sitting at the repo root, and the high-risk
untouched files (medals, burn, mint, admin, search, the frontend admin
surface) reviewed for the same class of bug the first two rounds found
elsewhere — writes before confirmation, stale reads, missing ownership
checks, ignored query params.

## Non-goals

- Rebuilding or redeploying the Solana escrow program. `programs/nftmarketplace`
  is a frozen reference for already-deployed bytecode; `escrow.ts` talks to it
  by hand-written IDL on purpose (see `## Verified facts`). This run may
  refactor how `escrow.ts` calls that program, never what the program does.
- Any change under `contracts-evm/`. `forge` is not installed and
  `contracts-evm/lib/` (openzeppelin, openzeppelin-upgradeable, forge-std) is
  not vendored in this environment, so `forge test` cannot grade a diff there
  (precondition P7). Existing coverage is already substantial — 36 test
  functions across both contracts, including reentrancy and fee-split fuzzing
  — so nothing found during grounding needs it anyway.
- Mainnet anything, Solana USDC, or float-based money handling — repo-wide
  constraints, not new to this run.
- Building a wallet-signature auth layer. The codebase has exactly one auth
  primitive today (the shared admin API key checked by `adminAuth`
  middleware). This run reuses that primitive; it does not design a new
  per-user session or signature-verification system.
- Re-litigating the eight already-fixed flow gaps listed in `## Goal`. They
  are grounding, not candidate work.

## Assumptions

Dated 2026-08-13, applied because they fell out of grounding rather than
needing a fresh ruling:

- The eight items listed in the run brief's "already FIXED" section are
  taken as given and out of scope for re-fixing; this run only verifies
  nothing it touches regresses them.
- `contracts-evm` is excluded from this run's editable scope (precondition
  P7's recommended default (b)), because `forge test` cannot grade it here
  and grounding found no bug in it worth editing blind.
- `programs/nftmarketplace` (the Rust source of the deployed escrow program)
  is kept as-is; it is documentation of live bytecode, not dead code, per
  its own README.
- `migrations/` and `tests/` at the repo root are v1 Anchor artifacts
  (`nftmarketplace.ts`/`.js`, `e2e-*.mjs`, `quick-escrow-test.mjs`,
  `deploy.js`/`.ts`). A repo-wide grep for references to either directory
  from any `.sh`, `.json`, or `.md` file (outside themselves) found none,
  and neither `Anchor.toml`'s `[scripts] test` entry nor any package.json
  script points at them in a way this run's checks exercise. Treated as
  confirmed-dead, not merely suspected-dead.

## Implementation decisions

**Seam 1 — the escrow RPC/instruction-encoding seam (`workerbackend/src/escrow.ts`).**
Every one of the six exported handlers (`createEscrow`-adjacent paths through
`buyNft`, `cancelListing`, `getListings`, admin resolve) independently
retries "primary RPC, catch a 401, fall back to the public devnet RPC" and
independently calls `getIDL()` — a function that returns a fresh IDL object
literal on every call — then indexes into `getIDL().instructions[N]` by
position to get an instruction discriminator. Two real adapters already
exist here (the paid RPC endpoint and the public fallback), which is what
licenses pulling this into one seam rather than leaving it inline: one retry
adapter that every handler calls through, and one named discriminator table
built once at module scope (keyed by instruction name — `create_escrow`,
`deposit_asset`, `buy_asset`, `cancel_escrow`, `close_escrow`,
`admin_resolve` — not by array index). Depth gain: six copies of retry logic
become one; a fix to retry semantics or a discriminator lookup bug fixes
itself everywhere at once instead of needing six coordinated edits.

**Seam 2 — the admin-gated route table (`workerbackend/src/index.ts`).**
`adminAuth` is an existing Hono middleware already applied to every
content-mutation route under `/api/admin/*` and `/api/admin/events/*`. Two
files register content-mutation routes without it: `album.ts` (create,
update, delete album; add, update, delete track — all unauthenticated) and
`upload.ts` (all four R2 upload endpoints — unauthenticated). This is not a
new interface; it is applying the existing seam where it was missed. No
handler code changes — the gate lives entirely in the route table, matching
how every other admin-gated route is already wired.

**Seam 3 — the OpenAPI contract (`workerbackend/src/openapi.ts`).**
The `paths` map is a hand-maintained interface for `/openapi.json` and the
Swagger UI. It currently lists 43 paths; the live route table in `index.ts`
has at least 17 more that never made it in — `/api/settle`,
`/api/solana/listing/sync`, `/api/solana/escrows`, `/api/evm/index-token`,
`/api/evm/index-listing`, `/api/admin/nfts/resolve-missing`,
`/api/admin/nfts/{assetId}/resolve`, `/api/admin/evm/index`,
`/api/admin/evm/index-listings`, `/api/admin/r2/{folder}/{filename}`,
`/api/admin/escrow/resolve`, `/health`, `/debug/db`, `/openapi.json` itself,
and the three `/cdn/*` read routes. Keep the hand-maintained shape (no
generator, no new build step) and add the missing entries — this is an
additive documentation fix to an existing interface, not a redesign.

**Slice family 4 — dead-code removal.** Delete `migrations/` and `tests/` at
the repo root (see `## Assumptions`). No module or interface involved; this
is deletion, not design.

**Slice family 5 — known-weak file correctness sweep.** The two prior audit
rounds read `nfts.ts`, `escrow.ts`, `evm.ts`, `settle.ts`, `db.ts`, `umi.ts`,
and the marketplace/collections frontend pages deeply enough to find and fix
eight bugs. They did not deeply read: `medals.ts` (event/points/medal-claim
flow — the vault key mints and transfers real assets), `burn.ts`, `mint.ts`,
`audit.ts`, `searchnftbyasset.ts`, `searchnftbyowner.ts`, the remaining
`admin.ts` handlers, and the frontend's `AdminPage.tsx`, `FilterSidebar.tsx`,
`NftCard.tsx`, `WalletButton.tsx`, and `hooks/useUmi.ts`. Each file becomes
its own issue: a correctness-only review and fix pass, no interface change
expected unless the investigation turns one up, diff scoped to its named
file(s) so the set stays disjoint and parallelizable. This is where "find
and fix bugs" mostly lands, now that the two structural flow gaps
(settlement, indexing) are already closed.

One finding from this sweep that did NOT become a committed slice:
`medals.ts` `joinEvent`/`claimMedal` accept a caller-supplied
`walletAddress` with no signature proving the caller controls it. Grounding
found this is not currently exploitable for theft — points can only reach a
wallet through an admin-authenticated `grantPoints` call tied to that exact
wallet, and a claim always transfers the medal to the wallet address named
in the request, so a claim on someone else's behalf benefits the named
wallet, not the caller. It is a real gap in defense-in-depth, not a proven
bug, and closing it means building the session/signature layer this run's
non-goals rule out. See `## Assumptions` for the recommended default; it is
also listed in the reply's `RULING NEEDED` block since it touches a
money-adjacent path.

## Validation strategy

Per `docs/runs/structure-flow/check-idiom.md` (already recorded this run):
no test framework exists in this repo, and `node api-test.mjs` (70 checks)
grades the **live deployment**, not a worktree, so it is not a valid
per-issue builder check — it belongs only in the orchestrator's closing
pass after merge and deploy.

Per-issue, worktree-local, builder-gradeable RUN items (per-issue frozen
checks draw from this set):

| Command | Cwd | Grades |
|---|---|---|
| `npx tsc --noEmit` | `workerbackend` | backend types compile |
| `npx tsc --noEmit` | `frontend` | frontend types compile |
| `npm run build` | `frontend` | bundle actually builds |
| `npx tsx security-check.ts` | `workerbackend` | existing pure assertions still hold |
| `npx tsx chains-check.ts` | `workerbackend` | existing pure assertions still hold |
| `npx tsx <new>-check.ts` | `workerbackend` | new pure assertions a slice adds (e.g. escrow discriminator-table equality against the six known instruction names; openapi path-set superset check against a literal route list) |

Per-slice grading notes:

- **Escrow dedup (seam 1):** grade with a new `*-check.ts` that asserts the
  discriminator table has exactly the six named entries and that they match
  the values the current inline `getIDL()` literal produces (a pure,
  worktree-local regression guard against a refactor silently changing a
  byte). `npx tsc --noEmit` catches call-site breakage. Behavior against the
  live program can only be confirmed by the orchestrator's `api-test.mjs`
  closing pass, since devnet RPC access and a funded keypair are not
  available to a builder's worktree.
- **Auth parity (seam 2):** `ADMIN_API_KEY` is absent locally (precondition
  P8), so a builder cannot exercise the authenticated path. Grade locally
  via an unauthenticated-request assertion (expect 401, not 200) against
  each newly-gated route — the same shape `security-check.ts` already uses
  for other admin routes. Full round-trip confirmation happens in the
  orchestrator's closing `api-test.mjs` pass against the live worker, which
  does have the key.
- **OpenAPI sync (seam 3):** grade with a pure check that the route list
  extracted from `index.ts`'s `app.<method>(...)` calls is a subset of
  `openapi.ts`'s `paths` keys (string-level check, no server needed).
- **Dead-code removal:** grade by `git status`/build passing with the
  directories gone plus `npx tsc --noEmit` in both packages (nothing should
  have imported from them, and grounding confirmed nothing does).
- **Known-weak sweep (slice family 5):** each issue is graded by
  `npx tsc --noEmit` (backend or frontend, matching the file) plus whatever
  the specific bug demands — if a fix is a pure-logic change, add or extend
  a `*-check.ts`; if it only shows up against live chain/DB state, say so in
  the issue and rely on the closing review plus the orchestrator's
  `api-test.mjs` pass.

The closing **final-review** pass audits the whole run diff against this
spec: confirms the eight pre-existing fixes still hold, confirms the escrow
seam has exactly one retry/discriminator implementation left, confirms the
OpenAPI path set is a superset of the live route table, and checks for the
cross-slice defects an isolated per-file sweep can't see (e.g., two
known-weak-file fixes touching the same Prisma model in incompatible ways).

## Domain language

- **RPC-fallback adapter** — the "try the configured RPC, retry against the
  public devnet RPC on a 401/unauthorized" behavior in `escrow.ts`; this run
  names it because seam 1 promotes it from six inline copies to one shared
  function.
- **Content-mutation route** — any route that creates, updates, or deletes a
  DB row or R2 object (as opposed to a read-only `GET`); the category seam 2
  gates uniformly.

## Open human decisions

None — every open question below is returned to the orchestrator as a
`RULING NEEDED` line for the timed-ruling protocol. This section stays
empty because the protocol resolves them before freeze.

## Verified facts

- `programs/README.md`, read 2026-08-13: the deployed escrow program
  (`3ozh4TQJbeyXFUuXsj7fYmHB5aCVkg24cZN5zZmigR44`) is "not rebuilt as part of
  v2, on purpose" — `escrow.ts` embeds a hand-written IDL and the deployed
  bytecode is the contract of record.
- `docs/runs/structure-flow/preconditions.md`, recorded 2026-08-13T17:18Z:
  `forge` is absent and `contracts-evm/lib/` (openzeppelin,
  openzeppelin-upgradeable, forge-std) is not vendored (P7, BLOCKED);
  `ADMIN_API_KEY` and `DATABASE_URL` are absent locally, Cloudflare-secret
  only (P8, P9).
- `contracts-evm/test/KumuleMarket.t.sol` + `KumuleNFT.t.sol`, read
  2026-08-13: 36 `function test`/`testFuzz` entries, covering list/buy/cancel
  happy paths, non-owner/non-approval/zero-price/double-listing rejections,
  reentrancy (`test_buy_cannotBeReentered`), fee-split fuzzing
  (`testFuzz_feeSplitNeverExceedsPrice`), and upgrade-preserves-state.
- `workerbackend/src/index.ts`, read 2026-08-13: every route under
  `/api/admin/*` and `/api/admin/events/*` is registered with `adminAuth` as
  the second argument; all nine `album.ts` routes (lines 213-221) and all
  four `upload.ts` mutation routes (lines 225-228) are registered without
  it.
- `workerbackend/src/album.ts` and `workerbackend/src/upload.ts`, read
  2026-08-13: neither file contains any `Authorization`/API-key check in its
  own handler bodies either — the gap is total, not just missing at the
  route-table layer.
- `workerbackend/src/openapi.ts`, read 2026-08-13: 43 unique `/api/...`
  paths present via `grep -oE "'/api[^']*'"`; cross-checked against
  `index.ts`'s route table, 17 live routes (listed in seam 3 above) have no
  entry.
- `workerbackend/src/escrow.ts`, read 2026-08-13: `getIDL` (line 77) returns
  a new object literal per call; six call sites independently catch
  `401`/`Invalid API key`/`Unauthorized` and retry against
  `https://api.devnet.solana.com`; three call sites index
  `getIDL().instructions[N]` by position (N = 0, 1, 2, 3, 4, 5 across the
  file) rather than by name.
- Repo-wide grep (`grep -rln` across `*.sh`, `*.json`, `*.md`, excluding
  `node_modules`) for references to `migrations/`, `tests/e2e`,
  `nftmarketplace.ts`, `nftmarketplace.js`, run 2026-08-13: zero matches
  outside the directories themselves.
- `workerbackend/src/medals.ts`, read 2026-08-13: `joinEvent` (line ~340)
  and `claimMedal` (line ~622) both accept `walletAddress` from the request
  body with no signature check; `grantPoints` (admin-gated) is the only path
  that increases a wallet's points, and `claimMedal` transfers the medal to
  the `walletAddress` named in the request, not to the caller's own
  session — so the missing signature does not enable stealing another
  wallet's medal under the current design.

## Preflight evidence

Carried over from the spec-stage canary already recorded in
`docs/runs/structure-flow/status-events.jsonl` and `preconditions.md`
(2026-08-13T17:17-17:18Z): repo is `v2-multichain`, clean, pushed; `gh`
2.94.0 authenticated as `Ansh-699` against `Ansh-699/kumule`; builder
backend canary `SHELLS_OK` (sonnet tier-down, worktrees add/remove clean,
workerbackend `tsc --noEmit` exit 0); `npx tsc --noEmit` OK in both
packages; `node api-test.mjs` 70/70 against the live deployment; `npx tsx
security-check.ts` and `chains-check.ts` OK; `npm run build` OK in
`frontend`; `forge test` blocked (P7); `ADMIN_API_KEY` and `DATABASE_URL`
absent locally (P8, P9).

This strategist pass added: full `workerbackend/src` and `frontend/src` file
inventories with line counts; confirmed `programs/`, `migrations/`, `tests/`
provenance via README and repo-wide grep; confirmed the `album.ts`/`upload.ts`
auth gap by reading both files and the `index.ts` route table; confirmed the
`openapi.ts` drift by diffing its path set against the live route table;
confirmed `contracts-evm/test/` coverage by reading both test files in full;
read `medals.ts` end to end for the claim/join/grant-points flow.
