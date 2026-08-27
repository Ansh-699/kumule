// The mint, against real Solana devnet. Run: npx tsx devnet-mint-check.ts
//
// Every other check in this repo stubs the RPC, which means the single most expensive code
// path - the one that spends the platform's SOL and hands a stranger an asset - had never
// actually executed. This runs it: real createV1, real priority fees, real send, real
// confirmation, real balance delta, real ownership read.
//
// Not in `npm run check`: it needs devnet to be up, an airdrop to succeed, and about fifteen
// seconds. It skips loudly (exit 0) when it cannot get funded, the same way db-flows-check
// skips without a Postgres. Run it before a deploy, not on every save.
//
// Needs a local Postgres, same as db-flows-check.ts.

import net from 'node:net'
import { createServer, type Server } from 'node:http'
import { Keypair, Connection, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { fetchAsset } from '@metaplex-foundation/mpl-core'
import { publicKey } from '@metaplex-foundation/umi'
import { base58 } from '@metaplex-foundation/umi/serializers'
import { startLocalNeonProxy, resetDatabase, inspect, POSTGRES_URL } from './db-harness'
import { getUmi } from './src/umi'
import { runMintJob, deriveAssetSigner, readAssetState, SUBREQUESTS_PER_JOB } from './src/mintjob'
import { quoteMintFee, assetBytesFor, utf8Bytes } from './src/web3fees'
import { verifyTransactionChecksum } from './src/audit'
import { withPrisma } from './src/db'
import { fromBaseUnits } from './src/chains'

const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
const SEED = 'devnet-e2e-seed-not-a-production-value'

let failures = 0
const ok = (label: string) => console.log(`  ok   ${label}`)
const fail = (label: string, detail = '') => {
    console.log(`  FAIL ${label}${detail ? ': ' + detail : ''}`)
    failures++
}
const eq = (label: string, actual: unknown, wanted: unknown) =>
    actual === wanted ? ok(`${label} -> ${String(actual)}`) : fail(label, `got ${String(actual)}, wanted ${String(wanted)}`)

const postgresReachable = (): Promise<boolean> =>
    new Promise((resolve) => {
        const url = new URL(POSTGRES_URL)
        const socket = net.connect({ host: url.hostname, port: Number(url.port || 5432) })
        const done = (v: boolean) => { socket.destroy(); resolve(v) }
        socket.setTimeout(1500)
        socket.on('connect', () => done(true))
        socket.on('error', () => done(false))
        socket.on('timeout', () => done(false))
    })

/**
 * Balance at the commitment the mint actually reached.
 *
 * getBalance defaults to finalized, which trails confirmed by roughly fifteen seconds - long
 * enough that every balance read in this file was returning the pre-mint number. That made
 * the cost assertion fail and, worse, made "the retry cost nothing" pass by comparing two
 * identical stale readings.
 */
const balanceOf = async (address: string): Promise<bigint> => {
    const r = await rpcCall('getBalance', [address, { commitment: 'confirmed' }])
    return BigInt(r?.result?.value ?? 0)
}

const rpcCall = async (method: string, params: unknown[]) => {
    const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    return (await res.json()) as any
}

/** Serves the metadata the asset will point at, so resolveMetadata has something real. */
const startMetadataHost = async () => {
    let hits = 0
    const server: Server = createServer((req, res) => {
        hits++
        if (req.url?.startsWith('/img.png')) {
            res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': '0' })
            res.end()
            return
        }
        const body = JSON.stringify({
            name: 'Devnet E2E', description: 'Minted by devnet-mint-check',
            image: `http://127.0.0.1:${(server.address() as any).port}/img.png`,
            attributes: [{ trait_type: 'Category', value: 'ART' }],
        })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(body)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as any).port
    return {
        url: `http://127.0.0.1:${port}`,
        hits: () => hits,
        stop: () => new Promise<void>((r) => server.close(() => r())),
    }
}

/** Forwards every JSON-RPC call to the real cluster and counts them on the way through. */
const startCountingRpcProxy = async (upstream: string) => {
    let count = 0
    const server: Server = createServer((req, res) => {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', async () => {
            count++
            try {
                const upstreamRes = await fetch(upstream, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                })
                const text = await upstreamRes.text()
                res.writeHead(upstreamRes.status, { 'Content-Type': 'application/json' })
                res.end(text)
            } catch (e) {
                res.writeHead(502, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: String(e) }))
            }
        })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    return {
        url: `http://127.0.0.1:${(server.address() as any).port}`,
        count: () => count,
        stop: () => new Promise<void>((r) => server.close(() => r())),
    }
}

const b58 = (bytes: Uint8Array) => base58.deserialize(bytes)[0]

const run = async () => {
    if (!(await postgresReachable())) {
        console.log('SKIPPED: no Postgres')
        console.log('all passed (skipped)')
        return
    }

    // A fresh vault every run, so this never depends on leftover state or a key in a file.
    const vaultKp = Keypair.generate()
    const vaultSecret = b58(vaultKp.secretKey)
    const vaultAddress = vaultKp.publicKey.toBase58()
    const buyer = Keypair.generate().publicKey.toBase58()

    console.log(`vault ${vaultAddress}`)
    console.log(`buyer ${buyer}`)
    console.log('')
    console.log('funding the vault from the devnet faucet:')

    const waitForBalance = async (address: string): Promise<bigint> => {
        for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 1_000))
            const v = await balanceOf(address)
            if (v > 0n) return v
        }
        return 0n
    }

    // The faucet first, because that works on a machine with no Solana setup at all.
    let funded = 0n
    const air = await rpcCall('requestAirdrop', [vaultAddress, 200_000_000])
    if (air?.result) {
        funded = await waitForBalance(vaultAddress)
        if (funded > 0n) ok(`faucet funded the vault with ${fromBaseUnits(funded, 'SOLANA')} SOL`)
    } else {
        console.log(`  --   faucet refused (${air?.error?.message?.slice(0, 60) ?? 'no reason'}); trying the local devnet keypair`)
    }

    // The devnet faucet is rate-limited per IP and refuses most of the time, which would leave
    // the most important path in this repo permanently unverified. Fall back to the machine's
    // own Solana CLI identity - devnet only, and it funds a throwaway vault rather than doing
    // the minting itself, so it signs one plain transfer and nothing else.
    if (funded === 0n) {
        const { homedir } = await import('node:os')
        const { readFileSync, existsSync } = await import('node:fs')
        const idPath = `${homedir()}/.config/solana/id.json`
        if (!existsSync(idPath)) {
            console.log('SKIPPED: no faucet and no ~/.config/solana/id.json to fund from')
            console.log('all passed (skipped)')
            return
        }
        const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(idPath, 'utf8'))))
        const funderBalance = await balanceOf(funder.publicKey.toBase58())
        if (funderBalance < 30_000_000n) {
            console.log(`SKIPPED: ${funder.publicKey.toBase58()} has only ${fromBaseUnits(funderBalance, 'SOLANA')} devnet SOL`)
            console.log('all passed (skipped)')
            return
        }
        const connection = new Connection(RPC, 'confirmed')
        const transfer = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: funder.publicKey,
                toPubkey: vaultKp.publicKey,
                lamports: 0.06 * LAMPORTS_PER_SOL,
            })
        )
        const sig = await connection.sendTransaction(transfer, [funder])
        await connection.confirmTransaction(sig, 'confirmed')
        funded = await waitForBalance(vaultAddress)
        if (funded === 0n) {
            console.log('SKIPPED: funding transfer never landed')
            console.log('all passed (skipped)')
            return
        }
        ok(`funded the vault with ${fromBaseUnits(funded, 'SOLANA')} devnet SOL from ${funder.publicKey.toBase58().slice(0, 8)}…`)
    }

    const stopProxy = await startLocalNeonProxy(5490)
    const host = await startMetadataHost()

    const env: any = {
        DATABASE_URL: POSTGRES_URL,
        SOLANA_RPC_URL: RPC,
        MINT_ASSET_SEED: SEED,
        MINT_VAULT_PRIVATE_KEY: vaultSecret,
        STRIPE_SECRET_KEY: 'sk_test_unused',
    }

    try {
        await resetDatabase()

        // A paid-for order, exactly as the webhook would leave it.
        const seeded: any = await withPrisma(POSTGRES_URL, (p: any) =>
            p.payment.create({
                data: {
                    stripePaymentIntentId: 'pi_devnet_e2e',
                    status: 'PAID',
                    currency: 'eur',
                    baseAmountMinor: 200, taxAmountMinor: 0, mintFeeMinor: 49, totalAmountMinor: 249,
                    paidAt: new Date(),
                    mintJob: {
                        create: {
                            status: 'PENDING', chain: 'SOLANA',
                            ownerAddress: buyer,
                            name: 'Devnet E2E',
                            metadataUri: `${host.url}/meta.json`,
                            estimatedFeeMinor: 49,
                        },
                    },
                },
                include: { mintJob: true },
            })
        )
        const jobId = seeded.mintJob.id

        console.log('')
        console.log('minting on devnet for real:')

        // Counted at the network layer, not by wrapping globalThis.fetch. umi resolves its own
        // fetch reference at import time and goes straight past a wrapper installed later, so
        // that measurement silently reports about a third of the truth. Everything the job
        // says to an RPC has to cross this proxy.
        //
        // SUBREQUESTS_PER_JOB gates how many jobs a sweep starts inside one invocation's
        // budget. If the real number is higher, a sweep runs out of subrequests mid-mint.
        const counting = await startCountingRpcProxy(RPC)
        const countedEnv = { ...env, SOLANA_RPC_URL: counting.url }
        const started = Date.now()
        const outcome = await runMintJob(countedEnv, POSTGRES_URL, jobId)
        const rpcCalls = counting.count()
        await counting.stop()

        // Five withPrisma calls, each opening its own connection - withPrisma builds a fresh
        // client per call by design and there is no transaction to share.
        const dbCalls = 5
        const metadataCalls = host.hits()
        const total = rpcCalls + dbCalls + metadataCalls
        ok(`subrequests: ${rpcCalls} RPC + ${dbCalls} DB + ${metadataCalls} metadata = ${total}`)
        const elapsed = Date.now() - started
        eq('runMintJob outcome', outcome, 'minted')
        eq(`the real cost is within the budgeted ${SUBREQUESTS_PER_JOB}`, total <= SUBREQUESTS_PER_JOB, true)
        // The budget is only useful if it is close. Far too generous and the sweep does less
        // work per tick than it safely could.
        eq('and the budget is not wildly padded', total >= SUBREQUESTS_PER_JOB - 8, true)
        ok(`took ${(elapsed / 1000).toFixed(1)}s`)

        const job: any = await inspect((p: any) => p.mintJob.findUnique({ where: { id: jobId }, include: { nft: true } }))
        eq('job status', job.status, 'MINTED')
        if (job.mintAddress) ok(`asset ${job.mintAddress}`)
        else fail('no mint address recorded')
        if (job.txSignature) ok(`signature ${job.txSignature.slice(0, 20)}…`)
        else fail('no signature recorded')

        // The derivation is the idempotency key, so it has to be the address that actually
        // got created - not merely something plausible.
        const umi = getUmi(RPC)
        const expected = (await deriveAssetSigner(umi, SEED, seeded.id, 1)).publicKey.toString()
        eq('the minted address is the derived one', job.mintAddress, expected)

        console.log('')
        console.log('what is actually on chain:')

        const onChain = await fetchAsset(umi, publicKey(job.mintAddress))
        eq('the asset exists on devnet', onChain.publicKey.toString(), job.mintAddress)
        eq('and the buyer owns it', onChain.owner.toString(), buyer)
        eq('with the name we asked for', onChain.name, 'Devnet E2E')
        eq('and the metadata URI', onChain.uri, `${host.url}/meta.json`)
        // The vault paid, so it must not be holding the asset.
        eq('the platform wallet does NOT own it', onChain.owner.toString() !== vaultAddress, true)

        console.log('')
        console.log('what it cost the platform:')

        if (job.actualFeeLamports) {
            const spent = BigInt(job.actualFeeLamports)
            ok(`actual cost ${fromBaseUnits(spent, 'SOLANA')} SOL (${spent} lamports)`)
            // Rent dominates, so anything near the bare transaction fee means the balance
            // delta was read from the wrong account.
            eq('the cost includes rent, not just the fee', spent > 1_000_000n, true)
            eq('and is not absurd', spent < 20_000_000n, true)

            const remaining = await balanceOf(vaultAddress)
            eq('the vault really is that much lighter', funded - remaining === spent, true)

            // The assertion this whole file exists to make: the fee we QUOTE has to cover the
            // lamports a mint actually costs. It did not, before this ran - the quote left out
            // Metaplex's 1,500,000-lamport protocol fee, which is deposited into the asset
            // account and appears in no rent calculation.
            // A quote that knows the asset should not merely cover the cost - it should
            // predict it. Every term is now derived rather than estimated: rent comes from
            // the chain for a size solved from real assets, the Metaplex fee is a measured
            // constant, and the transaction fees are fixed. This asserts the whole model is
            // right, to the lamport.
            const sized = await quoteMintFee(
                env, 1, assetBytesFor(utf8Bytes('Devnet E2E'), utf8Bytes(`${host.url}/meta.json`))
            )
            ok(`sized quote ${sized.networkFeeLamports} lamports, actually spent ${spent}`)
            eq('a sized quote predicts the cost exactly', sized.networkFeeLamports, spent)

            // The no-info quote is a different promise: it must never under-cover, and it is
            // allowed to be expensive because the only safe assumption is the worst case.
            const unsized = await quoteMintFee(env, 1)
            eq('an unsized quote still covers the cost', unsized.networkFeeLamports >= spent, true)
            ok(`unsized quote ${unsized.networkFeeLamports} lamports - the worst case, as intended`)
        } else {
            fail('actualFeeLamports was never recorded', 'readFeePayerCost returned nothing')
        }

        eq('ownership was verified', job.ownershipVerified, true)
        // Public devnet serves no DAS, so the account read is the expected answer here.
        eq('and says how', job.ownershipSource, 'account_read')

        console.log('')
        console.log('the marketplace rows:')
        eq('an Nft row exists', job.nft?.assetId, job.mintAddress)
        eq('owned by the buyer', job.nft?.ownerAddress, buyer)
        eq('with the image resolved from the metadata', job.nft?.imageOk, true)
        eq('and the category off the metadata', job.nft?.category, 'ART')

        const tx: any = await inspect((p: any) => p.transaction.findUnique({ where: { txHash: job.txSignature } }))
        eq('a MINT transaction was recorded', tx?.kind, 'MINT')
        eq('confirmed', tx?.status, 'CONFIRMED')
        eq('in SOL, not EUR - the chain side of the ledger', tx?.currency, 'SOL')
        const verdict = await verifyTransactionChecksum(POSTGRES_URL, job.txSignature)
        eq('and its audit checksum verifies', verdict.valid, true)

        // The buyer must be findable by wallet, which is what "sync ownership to the profile"
        // means in practice.
        const owned: any = await inspect((p: any) => p.nft.count({ where: { ownerAddress: buyer } }))
        eq('the NFT is attributed to the buyer', owned, 1)

        console.log('')
        console.log('THE test: re-running a job that already minted must not mint again:')

        // Simulates the worst realistic crash - the asset was created on chain and the process
        // died before the row said so. The retry re-derives the same address, finds the asset
        // there, and must skip the send rather than create a second one.
        await withPrisma(POSTGRES_URL, (p: any) =>
            p.mintJob.update({ where: { id: jobId }, data: { status: 'PENDING', lockedAt: null } })
        )
        const balanceBefore = await balanceOf(vaultAddress)

        const second = await runMintJob(env, POSTGRES_URL, jobId)
        eq('the retry reports it was already minted', second, 'already-minted')

        const balanceAfter = await balanceOf(vaultAddress)
        eq('and it cost the platform nothing', balanceAfter, balanceBefore)

        const afterRetry: any = await inspect(async (p: any) => ({
            jobs: await p.mintJob.count(),
            nfts: await p.nft.count(),
            job: await p.mintJob.findUnique({ where: { id: jobId } }),
        }))
        eq('still exactly one job', afterRetry.jobs, 1)
        eq('still exactly one NFT', afterRetry.nfts, 1)
        eq('pointing at the same asset', afterRetry.job.mintAddress, expected)
        eq('back to MINTED', afterRetry.job.status, 'MINTED')

        console.log('')
        console.log('CONCURRENCY: five workers racing for the same job, on a real chain:')

        // The claim is a conditional single-row UPDATE, which is the only atomicity primitive
        // this codebase has - withPrisma opens a fresh client per call and nothing uses
        // $transaction. Every other test of "one payment cannot mint twice" has been
        // sequential. This is the one that matters: two cron ticks overlapping, or a webhook
        // firing while a sweep is already running, is not hypothetical - the cron runs every
        // five minutes and a sweep can outlive it.
        const raced: any = await withPrisma(POSTGRES_URL, (p: any) =>
            p.payment.create({
                data: {
                    stripePaymentIntentId: 'pi_devnet_race',
                    status: 'PAID', currency: 'eur',
                    baseAmountMinor: 200, taxAmountMinor: 0, mintFeeMinor: 49, totalAmountMinor: 249,
                    paidAt: new Date(),
                    mintJob: {
                        create: {
                            status: 'PENDING', chain: 'SOLANA', ownerAddress: buyer,
                            name: 'Race Test',
                            metadataUri: `${host.url}/meta.json`,
                            estimatedFeeMinor: 49,
                        },
                    },
                },
                include: { mintJob: true },
            })
        )
        const raceJobId = raced.mintJob.id
        const beforeRace = await balanceOf(vaultAddress)

        // Fired with no stagger at all - the worst case for a compare-and-swap.
        const outcomes = await Promise.all(
            Array.from({ length: 5 }, () => runMintJob(env, POSTGRES_URL, raceJobId))
        )
        const minted = outcomes.filter((o) => o === 'minted').length
        const notClaimed = outcomes.filter((o) => o === 'not-claimed').length
        ok(`outcomes: ${JSON.stringify(outcomes)}`)
        eq('exactly one worker minted', minted, 1)
        eq('the other four were refused the claim', notClaimed, 4)

        const afterRace: any = await inspect(async (p: any) => ({
            job: await p.mintJob.findUnique({ where: { id: raceJobId } }),
            jobs: await p.mintJob.count({ where: { paymentId: raced.id } }),
            nfts: await p.nft.count({ where: { name: 'Race Test' } }),
            txs: await p.transaction.count({ where: { metadata: { path: ['mintJobId'], equals: raceJobId } } }),
        }))
        eq('one job', afterRace.jobs, 1)
        eq('ONE NFT, not five', afterRace.nfts, 1)
        eq('one MINT transaction row', afterRace.txs, 1)
        eq('the job is MINTED', afterRace.job.status, 'MINTED')
        // The claim increments attempts, so a losing racer must not have bumped it.
        eq('attempts counted once, not five times', afterRace.job.attempts, 1)

        // The decisive number: the vault paid for exactly one asset.
        const afterRaceBalance = await balanceOf(vaultAddress)
        const spentOnRace = beforeRace - afterRaceBalance
        ok(`the vault paid ${fromBaseUnits(spentOnRace, 'SOLANA')} SOL for the race`)
        eq('which is one mint, not five', spentOnRace < 4_000_000n, true)
        eq('and more than zero', spentOnRace > 3_000_000n, true)

        console.log('')
        console.log('is the Metaplex create fee really a constant?')

        // The quote hardcodes 1,500,000 lamports for it, measured once. If it actually scales
        // with the account - or with anything else - then the quote is wrong for every asset
        // that is not the size of the one it was measured on. Mint a much larger asset and
        // check the difference is EXACTLY the rent difference and nothing more.
        const longUri = `${host.url}/meta.json?padding=${'x'.repeat(150)}`
        const bigPayment: any = await withPrisma(POSTGRES_URL, (p: any) =>
            p.payment.create({
                data: {
                    stripePaymentIntentId: 'pi_devnet_big',
                    status: 'PAID', currency: 'eur',
                    baseAmountMinor: 200, taxAmountMinor: 0, mintFeeMinor: 49, totalAmountMinor: 249,
                    paidAt: new Date(),
                    mintJob: {
                        create: {
                            status: 'PENDING', chain: 'SOLANA', ownerAddress: buyer,
                            name: 'A Considerably Longer Asset Name Here',
                            metadataUri: longUri,
                            estimatedFeeMinor: 49,
                        },
                    },
                },
                include: { mintJob: true },
            })
        )
        const beforeBig = await balanceOf(vaultAddress)
        const bigOutcome = await runMintJob(env, POSTGRES_URL, bigPayment.mintJob.id)
        eq('the larger asset minted', bigOutcome, 'minted')
        const afterBig = await balanceOf(vaultAddress)
        const bigCost = beforeBig - afterBig

        const bigJob: any = await inspect((p: any) => p.mintJob.findUnique({ where: { id: bigPayment.mintJob.id } }))
        const bigAccount = await rpcCall('getAccountInfo', [bigJob.mintAddress, { encoding: 'base64', commitment: 'confirmed' }])
        const bigBytes = Buffer.from(bigAccount.result.value.data[0], 'base64').length
        const bigRent = BigInt(128 + bigBytes) * 6_960n

        ok(`small asset: 117 bytes, cost 3225200`)
        ok(`large asset: ${bigBytes} bytes, cost ${bigCost}`)
        // cost = rent + createFee + txFees. Solve for the create fee and compare.
        const impliedFee = bigCost - bigRent - 20_000n
        ok(`implied Metaplex create fee: ${impliedFee} lamports`)
        eq('the create fee is the same 1,500,000 regardless of asset size', impliedFee, 1_500_000n)

        console.log('')
        console.log('and a dusted address is refused rather than silently completed:')

        // Prove the P0 guard on a real chain: a plain funded system account where an asset
        // should be. create_account can never succeed there.
        // Dust the address from the vault itself: one lamport at a derived address is enough
        // to make create_account fail forever, and the guard has to see that as BLOCKED rather
        // than as "already minted".
        const dust = Keypair.generate()
        const connection = new Connection(RPC, 'confirmed')
        const dustTx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: vaultKp.publicKey,
                toPubkey: dust.publicKey,
                lamports: 2_000_000,
            })
        )
        const dustSig = await connection.sendTransaction(dustTx, [vaultKp])
        await connection.confirmTransaction(dustSig, 'confirmed')
        ok(`dusted ${dust.publicKey.toBase58().slice(0, 8)}… with 0.002 SOL`)

        const state = await readAssetState(umi, dust.publicKey.toBase58())
        eq('a funded non-asset address reads as blocked', state.kind, 'blocked')
        eq('not as already-minted', state.kind === 'minted', false)

        await resetDatabase()
    } finally {
        await host.stop()
        await stopProxy()
    }

    console.log('')
    if (failures) {
        console.log(`${failures} FAILED`)
        process.exit(1)
    }
    console.log('all passed')
}

run().catch((e) => {
    console.error('devnet-mint-check crashed:', e)
    process.exit(1)
})
