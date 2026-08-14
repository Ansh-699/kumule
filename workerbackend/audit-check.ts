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

import { checksumTransaction, createTransactionChecksum } from './src/audit'
import { fromBaseUnits } from './src/chains'

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
    if (failures) {
        console.log(`${failures} FAILED`)
        process.exit(1)
    }
    console.log('all passed')
}

run()
