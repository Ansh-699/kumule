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
omission, except the two public mint-flow upload routes named below), one
retry/discriminator seam in `escrow.ts` instead of eight independent copies
of it (see `## Verified facts` — the strategist pass found more duplication
than the intake draft counted, and one handler with none at all), an
OpenAPI doc that lists the routes that actually exist, no dead v1 Anchor
scaffolding sitting at the repo root, and the high-risk untouched files
(medals, burn, mint, admin, search, the frontend admin surface) reviewed
for the same class of bug the first two rounds found elsewhere — writes
before confirmation, stale reads, missing ownership checks, ignored query
params, and (newly found this pass) validation that checks a string's
length but not its actual encoding.

## Non-goals

- Rebuilding or redeploying the Solana escrow program. `programs/nftmarketplace`
  is a frozen reference for already-deployed bytecode; `escrow.ts` talks to it
  by hand-written IDL on purpose (see `## Verified facts`). This run may
  refactor how `escrow.ts` calls that program, never what the program does.
- Any change under `contracts-evm/`. `forge` is not installed and
  `contracts-evm/lib/` (openzeppelin, openzeppelin-upgradeable, forge-std) is
  not vendored in this environment, so `forge test` cannot grade a diff there
  (precondition P7). Existing coverage is already substantial — 43 test
  functions across both contracts (the intake draft undercounted this at 36;
  see `## Verified facts`), including reentrancy and fee-split fuzzing — so
  nothing found during grounding needs it anyway.
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
Five of the six exported handlers (`getListings`, `listNft`, `buyNft`,
`cancelListing`, `adminResolveEscrow`) independently retry "primary RPC,
catch a 401, fall back to the public devnet RPC" — eight times total, not
six, since `getListings` and `listNft` each contain more than one
independent retry block (see `## Verified facts`) — and independently call
`getIDL()`, a function that returns a fresh IDL object literal on every
call, then index into `getIDL().instructions[N]` by position to get an
instruction discriminator (seven call sites across six distinct indices,
0-5). The sixth handler, `syncListing`, has **no** retry fallback at all: its
one RPC call (`connection.getAccountInfo(escrowPDA)`, line 519) is
unprotected, so a landed purchase can fail to sync — and look to the caller
like the purchase itself failed — purely because the paid RPC key returned a
401, something every sibling handler already recovers from. Two real
adapters already exist here (the paid RPC endpoint and the public fallback),
which is what licenses pulling this into one seam rather than leaving it
inline: one retry adapter that every handler calls through — `syncListing`
included, which is how this refactor also closes that gap — and one named
discriminator table built once at module scope (keyed by instruction name —
`create_escrow`, `deposit_asset`, `buy_asset`, `cancel_escrow`,
`close_escrow`, `admin_resolve` — not by array index). Depth gain: eight
copies of retry logic (plus one handler silently missing it) become one; a
fix to retry semantics or a discriminator lookup bug fixes itself everywhere
at once instead of needing eight coordinated edits.

The same retry-on-401 shape also exists, independently, in two files outside
this seam's boundary: `searchnftbyowner.ts` (its whole primary code path is
duplicated inside the fallback branch, line 109-203) and `mint.ts` (line
182). Pulling those into the same shared adapter would require them to
import from `escrow.ts`, which is a legitimate follow-up but is not this
run's scope — see `RULING NEEDED` in the reply for the default.

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
Swagger UI. It currently lists 46 paths (the intake draft undercounted this
at 43); the live route table in `index.ts` has 67 distinct paths, so 21 are
undocumented, not 17 — and three of the intake draft's original 17 were
wrong: `/health`, `/debug/db`, and `/api/solana/escrows` are already
documented (lines 92, 96-98, 213-215 of `openapi.ts`). The corrected list of
21 (verified by extracting both path sets programmatically, see
`## Verified facts`): `/api/settle`, `/api/solana/listing/sync`,
`/api/solana/burn`, `/api/solana/burn/confirm`, `/api/nfts/{assetId}/like`,
`/api/nfts/{assetId}/liked`, `/api/evm/index-token`,
`/api/evm/index-listing`, `/api/albums/{id}/tracks/{trackId}`,
`/api/albums/{id}/tracks/{trackId}/metadata`, `/api/upload/files`,
`/cdn/images/{filename}`, `/cdn/metadata/{filename}`,
`/api/admin/nfts/resolve-missing`, `/api/admin/nfts/{assetId}/resolve`,
`/api/admin/evm/index`, `/api/admin/evm/index-listings`,
`/api/admin/r2/{folder}/{filename}`, `/api/admin/escrow/resolve`,
`/api/admin/events/{id}` (the `DELETE` method — `/api/admin/events` and
`/api/admin/events/{id}/points` are documented, but the bare
`/api/admin/events/{id}` path for `deleteEvent` is not), and `/openapi.json`
itself. Keep the hand-maintained shape (no generator, no new build step) and
add exactly these 21 entries — this is an additive documentation fix to an
existing interface, not a redesign.

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

This strategist pass read every file in the list and found six concrete,
reproducible bugs the intake draft had not yet surfaced (commands and exact
output in `## Verified facts`); each seeds its named issue rather than
leaving it a bare "go read this file" instruction:

- `mint.ts` (line 30, 56), `searchnftbyasset.ts` (line 14), and
  `searchnftbyowner.ts` (line 14) validate a Solana address by checking only
  `.length` (32-44 chars), never the shared `isSolanaAddress()` validator
  that `burn.ts` and `medals.ts` already use. A same-length string containing
  a base58-illegal character (`0`, `O`, `I`, `l`) passes this check and then
  fails later, deeper in the call stack: `mint.ts` returns a raw 500 leaking
  an `InvalidPublicKeyError` message; `searchnftbyasset.ts` returns a raw 500
  ("SOLANA\_RPC\_URL not configured", reached only because the bad address
  was never rejected); `searchnftbyowner.ts` is the worst of the three — it
  silently returns `200 []`, so a caller cannot tell "this wallet owns
  nothing" from "you sent garbage".
- `searchnftbyowner.ts` (line 109-203) also has its own independent copy of
  the escrow-style RPC-fallback retry pattern, with the entire primary-path
  formatting logic duplicated a second time inside the fallback branch.
- `frontend/src/hooks/useUmi.ts:12` hardcodes a live Helius devnet API key as
  the RPC URL fallback (`https://devnet.helius-rpc.com/?api-key=...`),
  shipped in the client bundle to every visitor.
- `frontend/src/pages/AdminPage.tsx:416` (`EventsTab`) bypasses the shared
  `API_BASE`/`request()` helpers in `lib/api.ts`, duplicating the base-URL
  fallback inline and calling `fetch(...).json()` with no `.ok` check, so a
  failed events fetch renders as an empty "No events yet" instead of
  surfacing the error the way every other admin tab does via `ErrorBox`.
- `frontend/src/components/NftCard.tsx:55` builds its hover-glow class as
  `` `hover:${ui.glow}` ``, a runtime string interpolation Tailwind's
  production scanner cannot see. Confirmed against a real build, not just
  inspection: `npm run build`'s output CSS contains zero `shadow-[` classes
  — the glow effect does not exist in production today.

Two further observations recorded but not escalated to their own bug: (1)
`burn.ts`'s `confirmBurn` verifies a signature landed and that the asset's
account is gone, but never checks the signature actually names this
specific `assetId`'s burn instruction — same-shape limitation as the
`medals.ts` finding below, not independently exploitable since a row can
only vanish this way when the asset is genuinely gone on chain; (2)
`admin.ts` and `audit.ts`, read in full, show no comparable bug — both
already carry the defensive patterns (timing-safe key compare, decimal-string
money, idempotent re-run guards) the other files are missing.

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

Per-slice grading notes. Every check named below was drafted and actually
executed against the current (unfixed) tree during this strategist pass —
each currently fails for exactly the reason its issue exists, proving it is
falsifiable rather than vacuous; exact commands and output are in the
per-issue check files under `docs/checks/structure-flow/`:

- **Escrow dedup (seam 1):** grade with a new `escrow-check.ts` that imports
  a named export `INSTRUCTION_DISCRIMINATORS` from `escrow.ts` (the
  interface seam 1 must produce) and asserts it has exactly the six named
  entries, byte-equal to the values the current inline `getIDL()` literal
  produces — pinned as literals in the check itself, read directly from
  `escrow.ts` lines 87-160 this pass, not recomputed at runtime, so the
  check does not trust the same code path it is grading. `npx tsc --noEmit`
  catches call-site breakage. Behavior against the live program can only be
  confirmed by the orchestrator's `api-test.mjs` closing pass, since devnet
  RPC access and a funded keypair are not available to a builder's worktree.
- **Auth parity (seam 2):** `ADMIN_API_KEY` is absent locally (precondition
  P8), so a builder cannot exercise the authenticated path. Grade locally
  via a wrong-key assertion (a configured-but-mismatched
  `X-Admin-API-Key` must draw 401 on every newly-gated route, and must NOT
  draw 401 on the two routes that stay public) against the real exported
  `app` from `index.ts` — not a rebuilt toy router — the same shape
  `security-check.ts` already uses for the existing admin routes, but
  exercising the actual route table so the check fails if `adminAuth` is
  wired to the wrong path or omitted. Full round-trip confirmation happens
  in the orchestrator's closing `api-test.mjs` pass against the live worker,
  which does have the key.
- **OpenAPI sync (seam 3):** grade with a pure `openapi-check.ts` that reads
  `index.ts`'s source text for every `app.<method>('...')` call, normalizes
  `:param` to `{param}`, and asserts the resulting set is a subset of
  `Object.keys(openAPISpec.paths)` imported from `openapi.ts` (string-level,
  no server needed). Run against the current tree this pass: 67 live paths,
  46 documented, 21 missing, listed by name — matching `## Verified facts`
  exactly.
- **Dead-code removal:** grade by `test ! -d migrations && test ! -d tests`
  plus `npx tsc --noEmit` in both packages (nothing should have imported
  from them, and grounding confirmed nothing does).
- **Known-weak sweep (slice family 5):** each issue is graded by
  `npx tsc --noEmit` (backend or frontend, matching the file) plus, for the
  three files with a concrete reproducible bug found this pass
  (`mint.ts`, `searchnftbyasset.ts`, `searchnftbyowner.ts`), a matching
  `*-check.ts` that POSTs/GETs a same-length base58-illegal address and
  asserts a clean 400 instead of today's raw 500 (`mint.ts`,
  `searchnftbyasset.ts`) or silent empty `200 []` (`searchnftbyowner.ts`).
  The other slice-5 issues (`medals.ts`, `burn.ts`, `audit.ts`, `admin.ts`,
  and the four frontend files) have no comparable pure-logic distinguishing
  test from this pass's reading and are graded by `npx tsc --noEmit` /
  `npm run build` plus the closing review; if a builder's own investigation
  turns up a pure-logic fix, extending a `*-check.ts` for it is encouraged
  but not required by the frozen check.

The closing **final-review** pass audits the whole run diff against this
spec: confirms the eight pre-existing fixes still hold, confirms the escrow
seam has exactly one retry/discriminator implementation left, confirms the
OpenAPI path set is a superset of the live route table, and checks for the
cross-slice defects an isolated per-file sweep can't see (e.g., two
known-weak-file fixes touching the same Prisma model in incompatible ways).

## Domain language

- **RPC-fallback adapter** — the "try the configured RPC, retry against the
  public devnet RPC on a 401/unauthorized" behavior in `escrow.ts`; this run
  names it because seam 1 promotes it from eight inline copies (plus one
  handler missing it entirely) to one shared function.
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
  2026-08-13, count corrected below: covering list/buy/cancel happy paths,
  non-owner/non-approval/zero-price/double-listing rejections, reentrancy
  (`test_buy_cannotBeReentered`), fee-split fuzzing
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
- `workerbackend/src/openapi.ts`, read 2026-08-13, corrected by the
  strategist pass: 46 top-level path keys (not 43 — the intake grep
  undercounted), confirmed by `grep -nE "^\s{8}'/[^']+':\s*\{"`. Against
  `index.ts`'s 67 distinct `app.<method>('...')` paths (extracted and
  diffed programmatically, `comm -23`/`comm -13` on sorted path sets), 21
  live routes have no `openapi.ts` entry (listed in seam 3 above) and zero
  documented paths are stale (every documented path is still live). The
  intake draft's list of 17 "missing" paths included three that are
  actually already documented (`/health`, `/debug/db`,
  `/api/solana/escrows`) and omitted eight real gaps (`/api/nfts/{assetId}/like`,
  `/api/nfts/{assetId}/liked`, `/api/solana/burn`,
  `/api/solana/burn/confirm`, `/api/albums/{id}/tracks/{trackId}`,
  `/api/albums/{id}/tracks/{trackId}/metadata`, `/api/upload/files`,
  `/api/admin/events/{id}`).
- `workerbackend/src/escrow.ts`, read 2026-08-13, corrected by the
  strategist pass: `getIDL` (line 77) returns a new object literal per call;
  eight call sites (not six — `getListings` has two, `listNft` has three,
  `buyNft`/`cancelListing`/`adminResolveEscrow` one each) independently
  catch `401`/`Invalid API key`/`Unauthorized` and retry against
  `https://api.devnet.solana.com` (exact line numbers: 180, 215, 287, 365,
  419, 620, 776, 888 — `grep -n "includes('401')" escrow.ts`); `syncListing`
  (lines 486-595) has none, its one RPC call at line 519 is unprotected.
  Seven call sites (317, 332, 348, 409, 662, 817, 930), not three, index
  `getIDL().instructions[N]` by position across six distinct indices (N =
  0-5, index 4/`close_escrow` used twice at 317 and 332). The same
  retry-on-401 shape recurs independently in `searchnftbyowner.ts` (line
  109) and `mint.ts` (line 182), outside this file.
- `contracts-evm/test/KumuleMarket.t.sol` + `KumuleNFT.t.sol`, recounted by
  the strategist pass: 43 `function test`/`testFuzz` entries (26 + 17), not
  36 — `grep -cE "^\s*function (test|testFuzz)"` per file. The specific
  tests the intake draft named (`test_buy_cannotBeReentered`,
  `testFuzz_feeSplitNeverExceedsPrice`) do exist as claimed.
- `frontend/src/hooks/useUmi.ts:12`, read 2026-08-13: hardcodes
  `https://devnet.helius-rpc.com/?api-key=0d4faf3d-ecf9-4bfe-8073-405021570776`
  as the RPC URL fallback when `VITE_SOLANA_RPC_URL` is unset — a live API
  key shipped in the client bundle.
- `frontend/src/components/NftCard.tsx:55` + `frontend/src/lib/chain-ui.ts`,
  read 2026-08-13 and confirmed against a real build: the hover-glow class
  is constructed as `` `hover:${ui.glow}` ``, where `ui.glow` is
  `'shadow-[0_0_24px_-8px_rgba(...)]'` — a runtime string interpolation
  Tailwind's static scanner cannot see. `cd frontend && npm run build &&
  grep -c "shadow-\[" dist/assets/*.css` returns `0`: the glow class is not
  merely at risk, it is verifiably absent from the shipped CSS today.
- `frontend/src/pages/AdminPage.tsx:416`, read 2026-08-13: `EventsTab`'s
  query function calls `fetch(...).json()` directly against a duplicated
  inline `API_BASE` fallback, bypassing `lib/api.ts`'s exported `API_BASE`
  and `request()` helpers (which every other tab in this file uses) and
  skipping the response-status check those helpers perform.
- `workerbackend/src/mint.ts:30,56`, `searchnftbyasset.ts:14`,
  `searchnftbyowner.ts:14`, read 2026-08-13 and probed directly (handlers
  invoked in-process with a same-length, base58-illegal address
  `0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl`, no network): all three validate with a
  raw `.length` check instead of `isSolanaAddress()`
  (`chains.ts:66`). Confirmed responses on the current tree: `mint.ts` ->
  500 `Mint failed: InvalidPublicKeyError: ...`; `searchnftbyasset.ts` -> 500
  `{"error":"SOLANA_RPC_URL not configured"}` (reached only because the bad
  address was never rejected); `searchnftbyowner.ts` -> 200 `[]`.
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

A second, adversarial strategist pass (this one, 2026-08-13) re-verified
every quantitative claim above against the actual code rather than trusting
the intake numbers, and found three FALSIFIED: the OpenAPI path count and
gap list (43/17 claimed vs. 46/21 actual, with three false positives in the
claimed gap list), the escrow retry-copy count (six claimed vs. eight
actual, plus one handler with zero), and the contracts-evm test count (36
claimed vs. 43 actual). It also read every slice-family-5 file in full
(not just skimmed for planning purposes) and found six reproducible bugs
the intake draft had not named, three of which were confirmed by directly
invoking the handler in-process (no live network) rather than by inspection
alone. Full ledger, per-item verdicts, and command output are in this run's
reply to the orchestrator, not duplicated here. One scope question this pass
surfaced and did not resolve unilaterally: whether `mint.ts` and
`searchnftbyowner.ts`'s independent copies of the RPC-fallback pattern
should be pulled into seam 1's new shared adapter (cross-issue dependency)
or left as local fixes within their own disjoint slice-5 issues (default
recommended in the reply's `RULING NEEDED`).
