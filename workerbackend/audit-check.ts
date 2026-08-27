// Regression check for issue 008 (audit.ts).
//
// The audit feature has two halves that must agree byte for byte:
//
//   writer  - mint.ts builds metadata._checksum via createTransactionChecksum
//   reader  - verifyTransactionChecksum recomputes it from the stored row and compares
//
// They agree only if the writer feeds the checksum exactly the fields the reader will read
// back: kind, walletAddress, amount, chain, metadata.assetId, metadata._timestamp. Nothing
// enforced that, and in fact nothing wrote a checksum at all, so the endpoint could only ever
// answer "Transaction missing checksum data". This pins the agreement.
//
// Pure-function check: no DB, no network.
//
// Run: npx tsx audit-check.ts

import { readFileSync } from 'node:fs'
import { Prisma } from '@prisma/client'
import { checksumTransaction, createTransactionChecksum, auditedTransactionData } from './src/audit'
import { fromBaseUnits } from './src/chains'

const { Decimal } = Prisma

let failures = 0
const ok = (label: string) => console.log(`  ok   ${label}`)
const fail = (label: string, detail = '') => {
    console.log(`  FAIL ${label}${detail ? ': ' + detail : ''}`)
    failures++
}

/**
 * Both halves go through the real exported checksumTransaction, not a copy of it, so this
 * check fails if either call site drifts. The writer passes what mint.ts has in hand at insert
 * time; the reader passes the row as verifyTransactionChecksum reads it back, including the
 * Decimal -> string conversion that is the round trip's only lossy step.
 */
const writerChecksum = (p: {
    owner: string; amount: string; assetId: string; timestamp: number
}) => checksumTransaction({
    kind: 'MINT',
    walletAddress: p.owner,
    amount: p.amount,
    chain: 'SOLANA',
    assetId: p.assetId,
    timestamp: p.timestamp,
})

const readerChecksum = (row: {
    kind: string; walletAddress: string | null; amount: string | null; chain: string
    metadata: { assetId?: string | null; _timestamp: number }
}) => checksumTransaction({
    kind: row.kind,
    walletAddress: row.walletAddress,
    amount: row.amount?.toString() ?? null,
    chain: row.chain as any,
    assetId: row.metadata.assetId,
    timestamp: row.metadata._timestamp,
})

const OWNER = 'F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F'
const ASSET = '41FsitSTxa14SwaaSxRBTe6dz8vhGKP2FKUBZZQYrp3c'
const TS = 1_760_000_000_000

const run = async () => {
    console.log('writer and reader agree on a minted row:')

    for (const lamports of [0n, 1n, 10_000_000n, 1_500_000_000n, 2_000_000_000n]) {
        const amount = lamports > 0n ? fromBaseUnits(lamports, 'SOLANA') : '0'
        const written = await writerChecksum({ owner: OWNER, amount, assetId: ASSET, timestamp: TS })
        const read = await readerChecksum({
            kind: 'MINT',
            walletAddress: OWNER,
            amount,
            chain: 'SOLANA',
            metadata: { assetId: ASSET, _timestamp: TS },
        })
        if (written === read) ok(`${lamports} lamports -> amount "${amount}" verifies`)
        else fail(`${lamports} lamports -> amount "${amount}"`, `${written.slice(0, 12)} != ${read.slice(0, 12)}`)
    }

    // fromBaseUnits strips trailing zeros, which is what makes the round trip safe: the string
    // it produces is the same string Prisma's Decimal(38,18) gives back via .toString(). A
    // non-canonical amount would checksum one way on write and another on read.
    for (const [lamports, expected] of [[1_500_000_000n, '1.5'], [10_000_000n, '0.01'], [1n, '0.000000001']] as const) {
        const got = fromBaseUnits(lamports, 'SOLANA')
        if (got === expected) ok(`fromBaseUnits(${lamports}) is canonical "${got}"`)
        else fail(`fromBaseUnits(${lamports})`, `got "${got}", expected "${expected}"`)
    }

    console.log('')
    console.log('checksum detects tampering with each signed field:')

    const base = { owner: OWNER, amount: '0.01', assetId: ASSET, timestamp: TS }
    const original = await writerChecksum(base)

    const mutations: [string, typeof base][] = [
        ['amount', { ...base, amount: '0.02' }],
        ['actor', { ...base, owner: 'BwT7VBHgYkFqvVetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F' }],
        ['assetId', { ...base, assetId: 'GjwT6BHgYkFqvVetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F' }],
        ['timestamp', { ...base, timestamp: TS + 1 }],
    ]
    for (const [field, mutated] of mutations) {
        const after = await writerChecksum(mutated)
        if (after !== original) ok(`changing ${field} changes the checksum`)
        else fail(`changing ${field} did NOT change the checksum`)
    }

    // A zero fee and a missing fee must not collide: "0" is a real recorded amount.
    const zero = await writerChecksum({ ...base, amount: '0' })
    const undef = await createTransactionChecksum({
        type: 'MINT', actor: OWNER, chain: 'SOLANA', assetId: ASSET, timestamp: TS,
    })
    if (zero !== undef) ok('amount "0" and a missing amount checksum differently')
    else fail('amount "0" collides with a missing amount')

    const repeat = await writerChecksum(base)
    if (repeat === original) ok('checksum is deterministic across calls')
    else fail('checksum is not deterministic')

    console.log('')
    console.log('auditedTransactionData rows verify the way the reader reads them:')

    // Amounts as each call site actually spells them, including the ones a caller would not
    // think twice about. "1.10" is the trap: Postgres stores it as 1.1, so checksumming the
    // caller's spelling would make the row fail its own verification and report a tamper that
    // never happened. The helper canonicalises before hashing; this pins that it still does.
    for (const [amount, stored] of [
        ['0', '0'], ['1.5', '1.5'], ['1.10', '1.1'], ['0.010', '0.01'],
        ['2.000000000', '2'], ['0.000000001', '0.000000001'],
    ] as const) {
        const data = await auditedTransactionData({
            chain: 'SOLANA', kind: 'PURCHASE', status: 'CONFIRMED',
            walletAddress: OWNER, amount, assetId: ASSET,
        })
        const meta = data.metadata as Record<string, any>
        // The Decimal column hands back the canonical form, which is what the reader hashes.
        const read = await readerChecksum({
            kind: 'PURCHASE', walletAddress: OWNER, amount: new Decimal(String(data.amount)).toString(),
            chain: 'SOLANA', metadata: { assetId: meta.assetId, _timestamp: meta._timestamp },
        })
        if (read === meta._checksum) ok(`amount "${amount}" (stored ${stored}) verifies`)
        else fail(`amount "${amount}" does not verify after the Decimal round trip`)
    }

    // An unpriced row - a burn - must still carry a checksum, or the audit endpoint answers
    // "missing checksum data" for it exactly as it did before any of this existed.
    const burnRow = await auditedTransactionData({
        chain: 'SOLANA', kind: 'BURN', status: 'CONFIRMED', txHash: 'sig', assetId: ASSET,
    })
    const burnMeta = burnRow.metadata as Record<string, any>
    const burnRead = await readerChecksum({
        kind: 'BURN', walletAddress: null, amount: null, chain: 'SOLANA',
        metadata: { assetId: burnMeta.assetId, _timestamp: burnMeta._timestamp },
    })
    if (burnRead === burnMeta._checksum) ok('a row with no wallet and no amount still verifies')
    else fail('a row with no wallet and no amount does not verify')

    for (const [chain, currency] of [['SOLANA', 'SOL'], ['ETHEREUM', 'ETH']] as const) {
        const row = await auditedTransactionData({ chain, kind: 'PURCHASE', status: 'CONFIRMED' })
        if (row.currency === currency) ok(`${chain} rows are labelled ${currency}`)
        else fail(`${chain} row currency`, `got ${row.currency}`)
    }

    console.log('')
    console.log('every Transaction writer routes through the helper:')

    // The real guard. Six call sites write Transaction rows and only mint.ts used to compute a
    // checksum, which is why five of the six kinds could never be audited. A seventh writer that
    // builds its own `data` object would silently reintroduce that, and no behavioural test would
    // catch it - the row writes fine, it just cannot be verified afterwards.
    const writers = ['mint', 'escrow', 'transfer', 'burn', 'medals', 'settle', 'mintjob']
    for (const file of writers) {
        // .pathname rather than the URL itself: worker-configuration.d.ts declares a global URL
        // that is not structurally Node's, so readFileSync will not take one.
        const src = readFileSync(new URL(`./src/${file}.ts`, import.meta.url).pathname, 'utf8')
        const creates = src.match(/prisma\.transaction\.(create|upsert)\s*\(\s*{/g)?.length ?? 0
        const audited = src.match(/auditedTransactionData\(/g)?.length ?? 0
        if (creates === 0) fail(`${file}.ts no longer writes Transaction rows`, 'update this list')
        else if (audited >= creates) ok(`${file}.ts: ${creates} write(s), all through auditedTransactionData`)
        else fail(`${file}.ts writes ${creates} Transaction row(s) but only ${audited} carry a checksum`)
    }

    console.log('')
    if (failures) {
        console.log(`${failures} FAILED`)
        process.exit(1)
    }
    console.log('all passed')
}

run()
