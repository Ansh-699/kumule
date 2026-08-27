// The whole rail, end to end, with every component real. Run: npx tsx e2e-check.ts
//
// Card payment in, NFT on chain out. Nothing here is a hand-written stub of something this
// code talks to:
//
//   Postgres      real, local
//   Solana        real devnet - the asset this creates is publicly verifiable afterwards
//   Stripe        stripe-mock, Stripe's own server generated from their OpenAPI spec, so the
//                 requests are validated against the real schema rather than echoed
//   rate oracle   real CoinGecko
//   handlers      the shipped ones, unmodified
//
// The one thing that cannot be real without a Stripe account is webhook DELIVERY, so the event
// is signed with the real HMAC and verified by the real verifier - which is the part that
// matters, and is separately pinned in stripe-check.ts against a fixture from Node's crypto.
//
// Needs: podman run -d --name kumule-pg ... postgres:16-alpine
//        podman run -d --name stripe-mock -p 12111:12111 docker.io/stripe/stripe-mock
//        a funded ~/.config/solana/id.json (devnet) or a working faucet
// Skips loudly without any of them.

import net from 'node:net'
import { createServer, type Server } from 'node:http'
import { Hono } from 'hono'
import { Keypair, Connection, SystemProgram, Transaction, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { publicKey } from '@metaplex-foundation/umi'
import { base58 } from '@metaplex-foundation/umi/serializers'
import { getAssetV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/assetV1AccountData'
import { startLocalNeonProxy, resetDatabase, inspect, POSTGRES_URL } from './db-harness'
import { getUmi } from './src/umi'
import { getFeeQuote } from './src/web3fees'
import { createIntent, getPayment, stripeWebhook } from './src/payments'
import { signPayloadForTest } from './src/stripe'
import { runMintJob } from './src/mintjob'
import { verifyTransactionChecksum } from './src/audit'
import { withPrisma } from './src/db'
import { fromBaseUnits } from './src/chains'

const RPC = 'https://api.devnet.solana.com'
const MOCK = 'http://127.0.0.1:12111'
const WHSEC = 'whsec_e2e_kumule_test'

let failures = 0
const ok = (l: string) => console.log(`  ok   ${l}`)
const fail = (l: string, d = '') => { console.log(`  FAIL ${l}${d ? ': ' + d : ''}`); failures++ }
const eq = (l: string, a: unknown, w: unknown) =>
    a === w ? ok(`${l} -> ${String(a)}`) : fail(l, `got ${String(a)}, wanted ${String(w)}`)

const reachable = (port: number, host = '127.0.0.1'): Promise<boolean> =>
    new Promise((res) => {
        const s = net.connect({ host, port })
        const done = (v: boolean) => { s.destroy(); res(v) }
        s.setTimeout(1500)
        s.on('connect', () => done(true)); s.on('error', () => done(false)); s.on('timeout', () => done(false))
    })

const rpcCall = async (method: string, params: unknown[]) =>
    (await (await fetch(RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })).json()) as any

const startMetadataHost = async () => {
    const server: Server = createServer((req, res) => {
        if (req.url?.startsWith('/img.png')) {
            res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': '0' }); res.end(); return
        }
        const port = (server.address() as any).port
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
            name: 'Kumule E2E', description: 'Bought with a card, minted on chain',
            image: `http://127.0.0.1:${port}/img.png`,
            attributes: [{ trait_type: 'Category', value: 'ART' }],
        }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    return { url: `http://127.0.0.1:${(server.address() as any).port}`, stop: () => new Promise<void>((r) => server.close(() => r())) }
}

/** Everything bound for Stripe goes to stripe-mock. src/stripe.ts is untouched. */
const redirectStripe = () => {
    const real = globalThis.fetch
    globalThis.fetch = (async (i: any, o?: any) => {
        const url = typeof i === 'string' ? i : i?.url ?? String(i)
        return url.startsWith('https://api.stripe.com')
            ? real(url.replace('https://api.stripe.com', MOCK), o)
            : real(i, o)
    }) as typeof fetch
    return () => { globalThis.fetch = real }
}

const b58 = (b: Uint8Array) => base58.deserialize(b)[0]

const run = async () => {
    if (!(await reachable(55432))) { console.log('SKIPPED: no Postgres'); console.log('all passed (skipped)'); return }
    if (!(await reachable(12111))) { console.log('SKIPPED: stripe-mock not running'); console.log('all passed (skipped)'); return }

    const vaultKp = Keypair.generate()
    const buyer = Keypair.generate().publicKey.toBase58()

    // Fund the vault: faucet first, the machine's devnet identity as fallback.
    let funded = 0n
    const air = await rpcCall('requestAirdrop', [vaultKp.publicKey.toBase58(), 200_000_000])
    const balanceOf = async (a: string) =>
        BigInt((await rpcCall('getBalance', [a, { commitment: 'confirmed' }]))?.result?.value ?? 0)
    if (air?.result) {
        for (let i = 0; i < 25 && funded === 0n; i++) { await new Promise(r => setTimeout(r, 1000)); funded = await balanceOf(vaultKp.publicKey.toBase58()) }
    }
    if (funded === 0n) {
        const { homedir } = await import('node:os'); const { readFileSync, existsSync } = await import('node:fs')
        const idPath = `${homedir()}/.config/solana/id.json`
        if (!existsSync(idPath)) { console.log('SKIPPED: no faucet and no local devnet keypair'); console.log('all passed (skipped)'); return }
        const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(idPath, 'utf8'))))
        if ((await balanceOf(funder.publicKey.toBase58())) < 30_000_000n) {
            console.log('SKIPPED: local devnet keypair is too low'); console.log('all passed (skipped)'); return
        }
        const conn = new Connection(RPC, 'confirmed')
        const sig = await conn.sendTransaction(
            new Transaction().add(SystemProgram.transfer({
                fromPubkey: funder.publicKey, toPubkey: vaultKp.publicKey, lamports: 0.03 * LAMPORTS_PER_SOL,
            })), [funder])
        await conn.confirmTransaction(sig, 'confirmed')
        for (let i = 0; i < 25 && funded === 0n; i++) { await new Promise(r => setTimeout(r, 1000)); funded = await balanceOf(vaultKp.publicKey.toBase58()) }
    }
    if (funded === 0n) { console.log('SKIPPED: vault never funded'); console.log('all passed (skipped)'); return }

    const stopProxy = await startLocalNeonProxy(5491)
    const host = await startMetadataHost()
    const restoreStripe = redirectStripe()

    const env: any = {
        DATABASE_URL: POSTGRES_URL,
        SOLANA_RPC_URL: RPC,
        STRIPE_SECRET_KEY: 'sk_test_e2e',
        STRIPE_WEBHOOK_SECRET: WHSEC,
        MINT_ASSET_SEED: 'e2e-seed-not-a-production-value',
        MINT_VAULT_PRIVATE_KEY: b58(vaultKp.secretKey),
    }

    const app = new Hono()
    app.get('/quote', getFeeQuote as any)
    app.post('/intent', createIntent as any)
    app.get('/payment/:paymentId', getPayment as any)
    app.post('/webhook', stripeWebhook as any)

    const post = (p: string, body: unknown) =>
        app.request(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env)

    const deliver = async (payload: object) => {
        const raw = JSON.stringify(payload)
        const ts = Math.floor(Date.now() / 1000)
        return app.request('/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Stripe-Signature': await signPayloadForTest(raw, WHSEC, ts) },
            body: raw,
        }, env)
    }

    try {
        await resetDatabase()
        const metadataUri = `${host.url}/meta.json`
        const name = 'Kumule E2E'

        console.log(`vault ${vaultKp.publicKey.toBase58()} funded with ${fromBaseUnits(funded, 'SOLANA')} SOL`)
        console.log(`buyer ${buyer}`)
        console.log('')
        console.log('1. the buyer asks what a mint costs')

        const nameBytes = new TextEncoder().encode(name).length
        const uriBytes = new TextEncoder().encode(metadataUri).length
        const qRes = await app.request(
            `/quote?operation=nft_mint&chain=solana&quantity=1&nameBytes=${nameBytes}&uriBytes=${uriBytes}`, {}, env)
        eq('   the quote is priced', qRes.status, 200)
        const quote = (await qRes.json()) as any
        ok(`   ${quote.display_amount} for ${quote.estimated_network_fee.sol} SOL of chain cost`)
        ok(`   fee estimator: ${quote.source}, confidence: ${quote.confidence}`)

        console.log('')
        console.log('2. checkout creates a real Stripe PaymentIntent')

        const iRes = await post('/intent', { quoteId: quote.quote_id, ownerAddress: buyer, name, metadataUri })
        eq('   the intent is created', iRes.status, 200)
        const intent = (await iRes.json()) as any
        ok(`   ${intent.breakdown.display.base} mint + ${intent.breakdown.display.nft_minting_fee} chain fee = ${intent.breakdown.display.total}`)
        eq('   a client secret comes back for the card form', typeof intent.clientSecret, 'string')

        const payment: any = await inspect((p: any) => p.payment.findUnique({ where: { id: intent.paymentId } }))
        ok(`   Stripe accepted it as ${payment.stripePaymentIntentId}`)
        const job0: any = await inspect((p: any) => p.mintJob.findFirst({ where: { paymentId: intent.paymentId } }))
        eq('   nothing is minted yet', job0.status, 'AWAITING_PAYMENT')

        console.log('')
        console.log('3. the card clears and Stripe says so')

        const wRes = await deliver({
            type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000),
            data: { object: { id: payment.stripePaymentIntentId } },
        })
        eq('   the signed event is accepted', wRes.status, 200)
        const paid: any = await inspect(async (p: any) => ({
            payment: await p.payment.findUnique({ where: { id: intent.paymentId } }),
            job: await p.mintJob.findFirst({ where: { paymentId: intent.paymentId } }),
        }))
        eq('   the payment is settled', paid.payment.status, 'PAID')
        eq('   and the mint is queued', ['PENDING', 'MINTING', 'MINTED'].includes(paid.job.status), true)

        console.log('')
        console.log('4. the mint runs on real Solana devnet')

        const before = await balanceOf(vaultKp.publicKey.toBase58())
        // The webhook may already have started it in the background; settle either way.
        let outcome = await runMintJob(env, POSTGRES_URL, paid.job.id)
        if (outcome === 'not-claimed') {
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 1000))
                const j: any = await inspect((p: any) => p.mintJob.findUnique({ where: { id: paid.job.id } }))
                if (j.status === 'MINTED') { outcome = 'minted'; break }
            }
        }
        eq('   the mint completed', ['minted', 'already-minted'].includes(outcome), true)

        const job: any = await inspect((p: any) => p.mintJob.findUnique({ where: { id: paid.job.id }, include: { nft: true } }))
        eq('   the job is MINTED', job.status, 'MINTED')
        ok(`   asset ${job.mintAddress}`)
        ok(`   https://explorer.solana.com/address/${job.mintAddress}?cluster=devnet`)

        console.log('')
        console.log('5. what the chain says, independently')

        const acct = await rpcCall('getAccountInfo', [job.mintAddress, { encoding: 'base64', commitment: 'confirmed' }])
        eq('   the account exists on devnet', acct?.result?.value !== null, true)
        const bytes = Buffer.from(acct.result.value.data[0], 'base64')
        const [asset] = getAssetV1AccountDataSerializer().deserialize(new Uint8Array(bytes))
        eq('   it decodes as an MPL Core asset', asset.key, 1)
        eq('   the BUYER owns it, not the platform', asset.owner.toString(), buyer)
        eq('   with the name that was paid for', asset.name, name)

        const spent = before - (await balanceOf(vaultKp.publicKey.toBase58()))
        ok(`   the platform spent ${fromBaseUnits(spent, 'SOLANA')} SOL`)
        eq('   which is exactly what was quoted', spent, BigInt(quote.estimated_network_fee.lamports))

        console.log('')
        console.log('6. the books balance')

        eq('   an Nft row exists', job.nft?.assetId, job.mintAddress)
        eq('   attributed to the buyer', job.nft?.ownerAddress, buyer)
        eq('   image resolved from the metadata', job.nft?.imageOk, true)
        eq('   ownership verified after minting', job.ownershipVerified, true)
        ok(`   estimated fee ${job.estimatedFeeMinor} minor vs actual ${job.actualFeeMinor} minor`)
        const verdict = await verifyTransactionChecksum(POSTGRES_URL, job.txSignature)
        eq('   the audit record verifies', verdict.valid, true)

        const status = (await (await app.request(`/payment/${intent.paymentId}`, {}, env)).json()) as any
        eq('   the buyer can see it succeeded', status.mint.status, 'MINTED')
        eq('   and which asset is theirs', status.mint.assetId, job.mintAddress)

        console.log('')
        console.log('7. a second order that cannot be delivered is refunded')

        // Sized for the asset it will actually mint. The first run of this asked for a
        // 5-byte name and then tried to mint a 6-byte one, and the oversize guard refused it -
        // correctly, but it made the refund path unreachable behind a 409.
        const doomedName = 'Doomed'
        const doomedBytes = new TextEncoder().encode(doomedName).length
        const q2 = (await (await app.request(
            `/quote?operation=nft_mint&chain=solana&nameBytes=${doomedBytes}&uriBytes=${uriBytes}`, {}, env)).json()) as any
        const i2Res = await post('/intent', {
            quoteId: q2.quote_id, ownerAddress: buyer, name: doomedName, metadataUri,
        })
        eq('   a second order is accepted', i2Res.status, 200)
        const i2 = (await i2Res.json()) as any
        // Deliberately not driven through the webhook. A succeeded event kicks off a detached
        // mint, which then races this call for the claim and wins about half the time - so the
        // assertion would report whichever caller lost rather than what the code did. On a
        // funded vault against real devnet that background worker would also genuinely mint,
        // which is the opposite of what this section is testing.
        await withPrisma(POSTGRES_URL, (p: any) =>
            p.payment.update({ where: { id: i2.paymentId }, data: { status: 'PAID', paidAt: new Date() } }))
        // Past the attempt cap. The cap is only acted on after the chain has confirmed no
        // asset exists, so this refunds rather than minting.
        await withPrisma(POSTGRES_URL, (p: any) =>
            p.mintJob.updateMany({ where: { paymentId: i2.paymentId }, data: { status: 'PENDING', attempts: 99, lockedAt: null } }))
        const j2: any = await inspect((p: any) => p.mintJob.findFirst({ where: { paymentId: i2.paymentId } }))
        const refundOutcome = await runMintJob(env, POSTGRES_URL, j2.id)
        eq('   it refunds rather than retrying', refundOutcome, 'refunded')

        const settled: any = await inspect(async (p: any) => ({
            payment: await p.payment.findUnique({ where: { id: i2.paymentId } }),
            job: await p.mintJob.findUnique({ where: { id: j2.id } }),
            nfts: await p.nft.count({ where: { name: doomedName } }),
        }))
        eq('   Stripe recorded the refund', typeof settled.payment.stripeRefundId, 'string')
        eq('   the payment reads refunded', settled.payment.status, 'REFUNDED')
        eq('   and nothing was minted for it', settled.nfts, 0)

        console.log('')
        console.log('8. the first buyer still has their NFT')
        const finalCheck = await rpcCall('getAccountInfo', [job.mintAddress, { encoding: 'base64', commitment: 'confirmed' }])
        eq('   untouched by the refund of another order', finalCheck?.result?.value !== null, true)

        await resetDatabase()
    } finally {
        restoreStripe()
        await host.stop()
        await stopProxy()
    }

    console.log('')
    if (failures) { console.log(`${failures} FAILED`); process.exit(1) }
    console.log('all passed')
}

run().catch((e) => { console.error('e2e-check crashed:', e); process.exit(1) })
