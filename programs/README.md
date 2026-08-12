# Solana programs

## nftmarketplace — `3ozh4TQJbeyXFUuXsj7fYmHB5aCVkg24cZN5zZmigR44`

Live on devnet, owned by `BPFLoaderUpgradeab1e`, upgrade authority
`A5sV4PkkVM4gm3rejACvKFgxEMmj8ouGsffSKT5qYVc8`. Six instructions: `create_escrow`,
`deposit_asset`, `buy_asset`, `cancel_escrow`, `close_escrow`, `admin_resolve`.

**This program is not rebuilt as part of v2, on purpose.** The backend does not consume a
generated IDL — `workerbackend/src/escrow.ts` embeds a hand-written IDL with hardcoded
instruction discriminators and assembles raw `TransactionInstruction`s. So the deployed
bytecode is the contract, and rebuilding would only risk changing it for no gain.

If you ever *do* need to rebuild: `Cargo.toml` pins `anchor-lang 0.32.1`, which wants
Solana 2.3.0, and `avm install 0.32.1` pulls an agave release tarball from GitHub that
failed to download on the dev box. Either retry it, or pin `anchor-lang` to 0.31.1 to match
the toolchain that is already installed — but note that changing Anchor versions changes the
emitted bytecode, so the program would need redeploying and the discriminators in
`escrow.ts` re-verified against the new IDL.

## Removed in v2

`reward-system` and `event-escrow` are gone. Both declared placeholder ids that were never
real addresses (`RewardSystem111…`, `EventEscrow111…`), neither was ever deployed, and
`reward.ts` pointed its "reward program" at `11111111111111111111111111111111` — the System
Program. 643 lines of source that never ran.

Medals need no custom program: they are MPL Core assets minted to the vault
(`3hrnj13sXVzJpqmSzaczEXSR4H7gAFLBu5w3Zqc9nEyV`) and transferred out by the vault key.
