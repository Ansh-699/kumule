// Asserts for src/mintjob.ts. Run: npx tsx mintjob-check.ts
//
// The mint job is the one place in this codebase where being wrong costs a customer money.
// It runs with nobody watching, minutes after the card cleared, and it can run twice at the
// same moment. Two properties keep that safe and both are pinned here.
//
// 1. The asset address is derived, not generated. A retry must target the SAME account, or a
//    transaction that was still in flight lands alongside a second mint and one payment
//    buys two NFTs. The addresses below are literals: if the derivation ever changes shape,
//    this fails instead of silently orphaning every open job.
//
// 2. An account existing at that address does NOT mean the mint succeeded. Solana's
//    create_account fails if the destination holds any lamports at all, whoever owns them -
//    so one dusted lamport bricks a job permanently. Reading that as "already minted" would
//    mark the job complete and the buyer would be charged for nothing. That distinction is
//    the difference between a retryable job and a stolen payment, so it is tested against a
//    stub RPC rather than reasoned about.
//
// No DB, no Stripe, no real chain: the RPC is a local stub.

import { createServer, type Server } from 'node:http'
import { PublicKey } from '@solana/web3.js'
import { publicKey as umiPublicKey } from '@metaplex-foundation/umi'
import { getAssetV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/assetV1AccountData'
import { getUmi } from './src/umi'
import { deriveAssetSigner, readAssetState, CURRENT_SEED_VERSION, SUBREQUESTS_PER_JOB } from './src/mintjob'
import { isSolanaAddress } from './src/chains'
import { MAX_MINT_ATTEMPTS, MINT_LEASE_MS } from './src/config'

let failures = 0
const ok = (label: string) => console.log(`  ok   ${label}`)
const fail = (label: string, detail = '') => {
    console.log(`  FAIL ${label}${detail ? ': ' + detail : ''}`)
    failures++
}
const eq = (label: string, got: unknown, want: unknown) => {
    const g = JSON.stringify(got), w = JSON.stringify(want)
    g === w ? ok(label) : fail(label, `got ${g} want ${w}`)
}

const MPL_CORE = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
const SYSTEM_PROGRAM = '11111111111111111111111111111111'
const OWNER = 'F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F'

/** An RPC that answers getAccountInfo from a map, so each case is an exact state. */
const startStubRpc = async (accounts: Map<string, { data: Uint8Array; owner: string }>) => {
    const server: Server = createServer((req, res) => {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
            const call = JSON.parse(raw || '{}')
            const answer = (one: any) => {
                const id = one?.id ?? 1
                if (one?.method === 'getAccountInfo') {
                    const hit = accounts.get(one.params?.[0])
                    return {
                        jsonrpc: '2.0', id,
                        result: {
                            context: { slot: 1 },
                            value: hit
                                ? {
                                    data: [Buffer.from(hit.data).toString('base64'), 'base64'],
                                    executable: false,
                                    lamports: 5_000_000,
                                    owner: hit.owner,
                                    rentEpoch: 0,
                                }
                                : null,
                        },
                    }
                }
                return { jsonrpc: '2.0', id, error: { code: -32601, message: one?.method } }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(Array.isArray(call) ? call.map(answer) : answer(call)))
        })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as any).port
    return { url: `http://127.0.0.1:${port}`, stop: () => new Promise<void>((r) => server.close(() => r())) }
}

const assetBytes = (owner: string, name: string) =>
    getAssetV1AccountDataSerializer().serialize({
        key: 1,
        owner: umiPublicKey(owner),
        updateAuthority: { __kind: 'None' },
        name,
        uri: 'https://example.invalid/asset.json',
        seq: null,
    })

const run = async () => {
    console.log('the asset address is derived, and pinned to literals:')

    const umi = getUmi('https://api.devnet.solana.com')

    // Ground truth. Not recomputed from the function under test - these are copied literals,
    // so a changed derivation fails here rather than passing by tautology.
    const FIXTURES: [string, string, number, string][] = [
        ['kumule-test-seed', 'pay_00000000-0000-4000-8000-000000000001', 1, 'Ce1jB9UKYJauLNws37DquooBVPVZPriL7MJ9t6wPrdd5'],
        ['kumule-test-seed', 'pay_00000000-0000-4000-8000-000000000002', 1, '6E8mJ3mrHTheWfJVSmotx4mtVhBH4WbGoKvAp89zk85X'],
        ['kumule-test-seed', 'pay_00000000-0000-4000-8000-000000000001', 2, 'LsXxmfpmh3tZpREQc45e7H9SM7e8TXXGHqYwzjunVou'],
        ['a-different-seed', 'pay_00000000-0000-4000-8000-000000000001', 1, '4C9B34VAmuEdLyW264RosEzu2Mijg5iRh8zEzjaZgRsW'],
    ]
    for (const [seed, paymentId, version, expected] of FIXTURES) {
        const signer = await deriveAssetSigner(umi, seed, paymentId, version)
        eq(`seed=${seed.slice(0, 12)} payment=…${paymentId.slice(-4)} v${version}`,
            signer.publicKey.toString(), expected)
    }

    // The property the whole retry story rests on.
    const a = await deriveAssetSigner(umi, 'kumule-test-seed', 'pay_x', 1)
    const b = await deriveAssetSigner(umi, 'kumule-test-seed', 'pay_x', 1)
    eq('the same inputs derive the same address every time', a.publicKey.toString(), b.publicKey.toString())

    const addresses = new Set<string>()
    for (let i = 0; i < 25; i++) {
        addresses.add((await deriveAssetSigner(umi, 'kumule-test-seed', `pay_${i}`, 1)).publicKey.toString())
    }
    eq('twenty-five payments derive twenty-five distinct addresses', addresses.size, 25)

    // A rotated seed must not silently reuse an address - that is what makes the stored-vs-derived
    // mismatch detectable instead of a second mint.
    const v1 = await deriveAssetSigner(umi, 'kumule-test-seed', 'pay_x', 1)
    const v2 = await deriveAssetSigner(umi, 'kumule-test-seed', 'pay_x', 2)
    eq('bumping the seed version changes the address', v1.publicKey.toString() !== v2.publicKey.toString(), true)

    const s1 = await deriveAssetSigner(umi, 'seed-one', 'pay_x', 1)
    const s2 = await deriveAssetSigner(umi, 'seed-two', 'pay_x', 1)
    eq('a different seed changes the address', s1.publicKey.toString() !== s2.publicKey.toString(), true)

    eq('a derived address is a valid 32-byte Solana key', isSolanaAddress(a.publicKey.toString()), true)
    // The signer has to be able to co-sign createV1; a bare Keypair cannot.
    eq('the derivation returns something that can sign', typeof a.signTransaction, 'function')
    eq('the current seed version is 1', CURRENT_SEED_VERSION, 1)

    console.log('')
    console.log('reading what is actually at the address:')

    const minted = new PublicKey(Buffer.alloc(32, 11)).toBase58()
    const dusted = new PublicKey(Buffer.alloc(32, 12)).toBase58()
    const garbage = new PublicKey(Buffer.alloc(32, 13)).toBase58()
    const empty = new PublicKey(Buffer.alloc(32, 14)).toBase58()

    const accounts = new Map<string, { data: Uint8Array; owner: string }>()
    accounts.set(minted, { data: assetBytes(OWNER, 'Minted Already'), owner: MPL_CORE })
    // One lamport of dust from anybody: a plain system account sitting where our asset should go.
    accounts.set(dusted, { data: new Uint8Array(0), owner: SYSTEM_PROGRAM })
    // Right program, unreadable contents.
    accounts.set(garbage, { data: new Uint8Array([9, 9, 9, 9]), owner: MPL_CORE })

    const rpc = await startStubRpc(accounts)
    try {
        const stubUmi = getUmi(rpc.url)

        const absent = await readAssetState(stubUmi, empty)
        eq('an unused address is absent, so the mint may proceed', absent.kind, 'absent')

        const already = await readAssetState(stubUmi, minted)
        eq('a real Core asset reads as minted', already.kind, 'minted')
        if (already.kind === 'minted') {
            eq('and reports its actual owner', already.owner, OWNER)
        }

        // THE case. An account exists, so a naive "does it exist" check would call this done
        // and the buyer would pay for nothing.
        const squatted = await readAssetState(stubUmi, dusted)
        eq('a dusted address is BLOCKED, never "already minted"', squatted.kind, 'blocked')
        if (squatted.kind === 'blocked') {
            eq('and says the account is not owned by MPL Core',
                squatted.reason.includes('not MPL Core'), true)
        }

        const unreadable = await readAssetState(stubUmi, garbage)
        eq('an unreadable Core account is BLOCKED, not minted', unreadable.kind, 'blocked')

        // A mint to the wrong owner is minted-but-unverified, which is a different problem
        // from not being minted; the job records ownershipVerified false rather than retrying
        // a mint that would now fail anyway.
        const other = new PublicKey(Buffer.alloc(32, 15)).toBase58()
        const someoneElse = new PublicKey(Buffer.alloc(32, 20)).toBase58()
        accounts.set(other, { data: assetBytes(someoneElse, 'Wrong Owner'), owner: MPL_CORE })
        const wrongOwner = await readAssetState(stubUmi, other)
        eq('an asset owned by someone else still reads as minted', wrongOwner.kind, 'minted')
        if (wrongOwner.kind === 'minted') {
            eq('with the owner it actually has', wrongOwner.owner !== OWNER, true)
        }
    } finally {
        await rpc.stop()
    }

    console.log('')
    console.log('the bounds that keep a sweep inside one invocation:')

    // This worker budgets against 50 subrequests per invocation (index.ts:249, admin.ts:556).
    // A job costing more than a third of that means fewer than three fit, which is the whole
    // reason the sweep counts rather than using a fixed batch size.
    eq('a job fits inside the invocation budget', SUBREQUESTS_PER_JOB < 50, true)
    eq('at least two jobs fit in one invocation', SUBREQUESTS_PER_JOB * 2 < 50, true)
    eq('attempts are capped so a doomed job is refunded, not retried forever',
        MAX_MINT_ATTEMPTS > 0 && MAX_MINT_ATTEMPTS <= 10, true)
    // Longer than one bounded confirm (8 x 1.5s) so a live job is never stolen mid-flight,
    // short enough that an evicted isolate does not strand a payment for an hour.
    eq('the lease outlasts a bounded confirm', MINT_LEASE_MS > 12_000, true)
    eq('but is not so long a stuck job waits an hour', MINT_LEASE_MS <= 15 * 60_000, true)

    console.log('')
    if (failures) {
        console.log(`${failures} FAILED`)
        process.exit(1)
    }
    console.log('all passed')
}

run().catch((e) => {
    console.error('mintjob-check crashed:', e)
    process.exit(1)
})
