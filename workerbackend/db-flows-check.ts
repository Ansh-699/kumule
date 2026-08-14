// The half of this codebase that had never been run: everything that writes to, or reads from,
// a real database.
//
// Every other check here stops at a 400 or a 503, because withPrisma builds a Neon adapter and
// there was no Neon to talk to. So the handlers were verified up to the point where they touch
// data and no further - which is where the interesting bugs live. db-harness.ts closes that gap
// without changing a line of src/: a WebSocket-to-TCP relay under neonConfig.wsProxy lets the
// shipped adapter reach a local Postgres.
//
// What this pins:
//   - listNfts actually filters, including the price boundaries the API contract promises
//   - ensureUser keeps one identity per (chain, address) and per person across chains
//   - every Transaction kind writes a checksum that verifyTransactionChecksum accepts, and
//     rejects after tampering. Only MINT used to, so five of six kinds could not be audited.
//   - confirmBurn removes the row and its dependents, and records an auditable BURN
//
// Needs Postgres. Skips loudly rather than failing if there is none, so `npm run check` still
// works on a machine without one:
//   podman run -d --name kumule-pg -e POSTGRES_PASSWORD=kumule -e POSTGRES_USER=kumule \
//     -e POSTGRES_DB=kumule -p 55432:5432 docker.io/library/postgres:16-alpine
//   DATABASE_URL=postgresql://kumule:kumule@localhost:55432/kumule npx prisma migrate deploy
//
// Run: npx tsx db-flows-check.ts

import net from 'node:net'
import { createServer, type Server } from 'node:http'
import { Hono } from 'hono'
import { PublicKey, Keypair } from '@solana/web3.js'
import { base58, publicKey as umiPublicKey } from '@metaplex-foundation/umi'
import { getAssetV1AccountDataSerializer } from '@metaplex-foundation/mpl-core/dist/src/generated/types/assetV1AccountData'

const bs58Encode = (b: Uint8Array) => base58.deserialize(b)[0]
import { startLocalNeonProxy, resetDatabase, inspect, POSTGRES_URL } from './db-harness'
import { listNfts } from './src/nfts'
import { confirmBurn } from './src/burn'
import { settle } from './src/settle'
import { claimMedal } from './src/medals'
import { ensureUser, linkWallet, withPrisma } from './src/db'
import { auditedTransactionData, verifyTransactionChecksum } from './src/audit'

let failures = 0
const ok = (label: string) => console.log(`  ok   ${label}`)
const fail = (label: string, detail = '') => {
    console.log(`  FAIL ${label}${detail ? ': ' + detail : ''}`)
    failures++
}
const eq = (label: string, actual: unknown, wanted: unknown) =>
    actual === wanted ? ok(`${label} -> ${String(actual)}`) : fail(label, `got ${String(actual)}, wanted ${String(wanted)}`)

const SELLER = 'F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F'
const BUYER = '41FsitSTxa14SwaaSxRBTe6dz8vhGKP2FKUBZZQYrp3c'
const RACER = '3ozh4TQJbeyXFUuXsj7fYmHB5aCVkg24cZN5zZmigR44'
const MPL_CORE_PROGRAM = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
const BLOCKHASH = new PublicKey(Buffer.alloc(32, 3)).toBase58()
// 64 bytes base58: the shape verifySolanaTransaction insists on before it will ask the chain.
const SIGNATURE = bs58Encode(Buffer.alloc(64, 4))
const EVM_MIXED = '0xAbC0000000000000000000000000000000000001'
// Real 32-byte keys, encoded by the same library the handlers decode with. A base58 string of
// the right length is not enough: confirmBurn validates, then hands the value to publicKey().
const ASSET = (n: number) => new PublicKey(Buffer.alloc(32, n)).toBase58()

/** Is a Postgres listening? Checked with a bare socket so a miss costs nothing. */
const postgresReachable = async (): Promise<boolean> => {
    const url = new URL(POSTGRES_URL)
    return new Promise((resolve) => {
        const s = net.connect({ host: url.hostname, port: Number(url.port || 5432) })
        const done = (v: boolean) => { s.destroy(); resolve(v) }
        s.setTimeout(1500)
        s.on('connect', () => done(true))
        s.on('error', () => done(false))
        s.on('timeout', () => done(false))
    })
}

/**
 * Account bytes the stub serves, keyed by address.
 *
 * Built with mpl-core's own serializer rather than a hand-rolled blob, so what fetchAssetV1
 * decodes is the layout the program writes. A fake that the real deserializer accepts is the
 * only kind worth testing against.
 */
const accounts = new Map<string, Uint8Array>()

const putAsset = (address: string, owner: string, name: string) =>
    accounts.set(address, getAssetV1AccountDataSerializer().serialize({
        key: 1, // Key.AssetV1
        owner: umiPublicKey(owner),
        updateAuthority: { __kind: 'None' },
        name,
        uri: 'https://example.invalid/asset.json',
        seq: null,
    }))

const SENT: string[] = []

/**
 * A Solana RPC that answers exactly what these flows need: the signature landed without error,
 * and an account is either in `accounts` or gone. Anything it does not know about is an error,
 * so a handler that starts asking new questions fails loudly instead of quietly.
 */
const startStubRpc = async (): Promise<{ url: string; stop: () => Promise<void> }> => {
    const server: Server = createServer((req, res) => {
        let raw = ''
        req.on('data', (d: Buffer) => (raw += d))
        req.on('end', () => {
            res.setHeader('Content-Type', 'application/json')
            let parsed: any
            try { parsed = JSON.parse(raw) } catch { parsed = {} }

            // web3.js matches responses to requests by id, and batches some calls, so the reply
            // has to mirror the request rather than always answer as id 1.
            const ctx = { apiVersion: '2.0.0', slot: 1 }
            const answer = (call: any) => {
                const id = call?.id ?? 1
                switch (call?.method) {
                    case 'getTransaction':
                        return { jsonrpc: '2.0', id, result: { meta: { err: null } } }
                    // A missing account is a burned one: the only answer that may lead to a delete.
                    case 'getAccountInfo': {
                        const data = accounts.get(call.params?.[0])
                        return {
                            jsonrpc: '2.0', id,
                            result: {
                                context: ctx,
                                value: data
                                    ? {
                                        data: [Buffer.from(data).toString('base64'), 'base64'],
                                        executable: false,
                                        lamports: 5_000_000,
                                        owner: MPL_CORE_PROGRAM,
                                        rentEpoch: 0,
                                        space: data.length,
                                    }
                                    : null,
                            },
                        }
                    }
                    case 'getLatestBlockhash':
                        return {
                            jsonrpc: '2.0', id,
                            result: { context: ctx, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 1000 } },
                        }
                    case 'sendTransaction': {
                        // Nothing is broadcast; the point is that the handler got as far as
                        // sending, and that what it does afterwards lands in the database.
                        const signature = SIGNATURE
                        SENT.push(signature)
                        return { jsonrpc: '2.0', id, result: signature }
                    }
                    default:
                        if (process.env.STUB_RPC_DEBUG) console.log('  [stub] unhandled', call?.method)
                        return {
                            jsonrpc: '2.0', id,
                            error: { code: -32601, message: `stub has no answer for ${call?.method}` },
                        }
                }
            }

            res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(answer) : answer(parsed)))
        })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    return {
        url: `http://127.0.0.1:${port}`,
        stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    }
}

const run = async () => {
    if (!(await postgresReachable())) {
        console.log(`SKIPPED: no Postgres on ${POSTGRES_URL.replace(/:[^:@]+@/, ':***@')}`)
        console.log('See the header of this file for the two commands that start one.')
        return
    }

    const stopProxy = await startLocalNeonProxy()
    const rpc = await startStubRpc()
    const env = { DATABASE_URL: POSTGRES_URL, SOLANA_RPC_URL: rpc.url }

    try {
        await resetDatabase()

        // ---------------------------------------------------------------- ensureUser
        console.log('ensureUser holds one identity per wallet, and one person across chains:')

        await withPrisma(POSTGRES_URL, async (prisma) => {
            const first = await ensureUser(prisma, 'SOLANA', SELLER)
            const again = await ensureUser(prisma, 'SOLANA', SELLER)
            eq('the same Solana wallet resolves to one user', again, first)

            // The reason uniqueness is (chain, address) and not address: EVM addresses are
            // case-insensitive, so a checksummed and a lowercased form are the same wallet.
            const mixed = await ensureUser(prisma, 'ETHEREUM', EVM_MIXED)
            const lower = await ensureUser(prisma, 'ETHEREUM', EVM_MIXED.toLowerCase())
            eq('checksummed and lowercase EVM addresses are one user', lower, mixed)

            const stored = await prisma.wallet.findUnique({
                where: { chain_address: { chain: 'ETHEREUM', address: EVM_MIXED.toLowerCase() } },
            })
            eq('the EVM wallet is stored normalised', stored?.address, EVM_MIXED.toLowerCase())

            // Solana base58 is case-sensitive and must survive untouched, or a lookup by the
            // owner's own address matches nothing.
            const solWallet = await prisma.wallet.findUnique({
                where: { chain_address: { chain: 'SOLANA', address: SELLER } },
            })
            eq('the Solana wallet is stored verbatim', solWallet?.address, SELLER)

            // Linking is what makes one person's two chains a single account.
            await linkWallet(prisma, first, 'ETHEREUM', '0x' + '2'.repeat(40))
            const linked = await prisma.wallet.count({ where: { userId: first } })
            eq('a linked wallet joins the existing user', linked, 2)

            await prisma.user.count().then(() => undefined)
        })

        await withPrisma(POSTGRES_URL, async (prisma) => {
            // Two requests can race between the findUnique and the create; the unique index is
            // the real guard and a P2002 has to read as success, not as a 500.
            const ids = await Promise.all(
                Array.from({ length: 5 }, () => ensureUser(prisma, 'SOLANA', RACER))
            )
            const unique = new Set(ids)
            eq('five concurrent ensureUser calls create one user', unique.size, 1)
        })

        // ---------------------------------------------------------------- listNfts
        console.log('')
        console.log('listNfts filters real rows:')

        await withPrisma(POSTGRES_URL, async (prisma) => {
            const seed = async (o: {
                n: number; chain: 'SOLANA' | 'ETHEREUM'; price?: string; hidden?: boolean; owner?: string
            }) => {
                const nft = await prisma.nft.create({
                    data: {
                        chain: o.chain,
                        assetId: o.chain === 'SOLANA' ? ASSET(o.n) : `0xdead:${o.n}`,
                        name: `Asset ${o.n}`,
                        ownerAddress: o.owner ?? (o.chain === 'SOLANA' ? SELLER : EVM_MIXED.toLowerCase()),
                        hidden: o.hidden ?? false,
                        imageOk: true,
                    },
                })
                if (o.price !== undefined) {
                    await prisma.listing.create({
                        data: {
                            nftId: nft.id, chain: o.chain, sellerAddress: nft.ownerAddress,
                            price: o.price, currency: o.chain === 'SOLANA' ? 'SOL' : 'ETH',
                            status: 'ACTIVE',
                        },
                    })
                }
                return nft
            }
            await seed({ n: 1, chain: 'SOLANA', price: '1.5' })
            await seed({ n: 2, chain: 'SOLANA', price: '0.5' })
            await seed({ n: 3, chain: 'SOLANA' })
            await seed({ n: 4, chain: 'ETHEREUM', price: '0.01' })
            await seed({ n: 5, chain: 'SOLANA', price: '9.9', hidden: true })
        })

        const app = new Hono()
        app.get('/nfts', listNfts as any)
        const list = async (qs: string) => {
            const res = await app.request(`/nfts?${qs}`, {}, env)
            if (res.status !== 200) throw new Error(`GET /nfts?${qs} -> ${res.status} ${await res.text()}`)
            const body = await res.json() as { data: { name: string }[]; total: number }
            return body.data.map((d) => d.name).sort().join(', ')
        }

        eq('no filter shows only listed, unhidden assets', await list(''), 'Asset 1, Asset 2, Asset 4')
        eq('hidden assets stay off the shelf', (await list('includeHidden=false')).includes('Asset 5'), false)
        eq('includeHidden=true brings the hidden one back', await list('includeHidden=true'), 'Asset 1, Asset 2, Asset 4, Asset 5')
        eq('listedOnly=false includes unlisted inventory', await list('listedOnly=false'), 'Asset 1, Asset 2, Asset 3, Asset 4')
        eq('chain=SOLANA excludes the Base asset', await list('chain=SOLANA'), 'Asset 1, Asset 2')

        // The boundaries the API contract promises, which no test had ever exercised against a
        // Decimal column: gte and lte, not gt and lt.
        eq('minPrice=1.5 includes the asset priced at exactly 1.5', await list('minPrice=1.5'), 'Asset 1')
        eq('maxPrice=0.5 includes the asset priced at exactly 0.5', await list('maxPrice=0.5'), 'Asset 2, Asset 4')
        eq('minPrice=0.6&maxPrice=2 is an inclusive band', await list('minPrice=0.6&maxPrice=2'), 'Asset 1')
        eq('a price filter implies listed-only', (await list('minPrice=0')).includes('Asset 3'), false)
        // ".5" reaches Prisma.Decimal intact rather than being rejected or silently dropped.
        eq('minPrice=.5 filters rather than being ignored', await list('minPrice=.5'), 'Asset 1, Asset 2')
        eq('minPrice=1e9 is still refused', (await app.request('/nfts?minPrice=1e9', {}, env)).status, 400)

        // Browsing one wallet is a portfolio, so unlisted items are the point.
        eq('owner=<wallet> shows unlisted inventory', await list(`owner=${SELLER}`), 'Asset 1, Asset 2, Asset 3')
        // An EVM owner given checksummed must match the lowercased column.
        eq('a checksummed EVM owner still matches', await list(`owner=${EVM_MIXED}&listedOnly=false`), 'Asset 4')

        // ---------------------------------------------------------------- audit
        console.log('')
        console.log('every transaction kind writes a checksum the audit endpoint accepts:')

        const kinds: { kind: string; amount?: string; txHash: string }[] = [
            { kind: 'MINT', amount: '0', txHash: 'sig-mint' },
            { kind: 'PURCHASE', amount: '1.10', txHash: 'sig-purchase' },
            { kind: 'TRANSFER', amount: '0.000000001', txHash: 'sig-transfer' },
            { kind: 'BURN', txHash: 'sig-burn' },
            { kind: 'MEDAL_CLAIM', txHash: 'sig-medal' },
        ]
        for (const k of kinds) {
            await withPrisma(POSTGRES_URL, (prisma) =>
                auditedTransactionData({
                    chain: 'SOLANA', kind: k.kind, status: 'CONFIRMED',
                    walletAddress: BUYER, amount: k.amount, txHash: k.txHash, assetId: ASSET(1),
                }).then((data) => prisma.transaction.create({ data }))
            )
            const verdict = await verifyTransactionChecksum(POSTGRES_URL, k.txHash)
            if (verdict.valid) ok(`${k.kind} (amount ${k.amount ?? 'none'}) verifies through the real column`)
            else fail(`${k.kind} does not verify`, verdict.message)
        }

        // Verification has to be worth something: a row edited behind the API's back must fail.
        await inspect((p) => p.transaction.update({
            where: { txHash: 'sig-purchase' }, data: { amount: '9.99' },
        }))
        const tampered = await verifyTransactionChecksum(POSTGRES_URL, 'sig-purchase')
        eq('an amount edited directly in the database fails verification', tampered.valid, false)

        const missing = await verifyTransactionChecksum(POSTGRES_URL, 'sig-does-not-exist')
        eq('an unknown identifier is not found', missing.message, 'Transaction not found')

        // The row id is the other identifier callers hold.
        const byId = await inspect<{ id: string }>((p) => p.transaction.findUnique({ where: { txHash: 'sig-mint' } }))
        const idVerdict = await verifyTransactionChecksum(POSTGRES_URL, byId.id)
        eq('the same row verifies by id as well as by hash', idVerdict.valid, true)

        // ---------------------------------------------------------------- buy -> settle
        console.log('')
        console.log('a confirmed purchase settles into the database:')

        const soldAsset = ASSET(11)
        putAsset(soldAsset, BUYER, 'Sold One')
        // Ids, not filters: other rows in this database share a seller and a buyer, and an
        // assertion that can be satisfied by the wrong row is not an assertion.
        const sale = await withPrisma(POSTGRES_URL, async (prisma) => {
            const buyerUserId = await ensureUser(prisma, 'SOLANA', BUYER)
            const nft = await prisma.nft.create({
                data: { chain: 'SOLANA', assetId: soldAsset, mintAddress: soldAsset, name: 'Sold One', ownerAddress: SELLER, imageOk: true },
            })
            const listing = await prisma.listing.create({
                data: {
                    nftId: nft.id, chain: 'SOLANA', sellerAddress: SELLER, price: '1.10',
                    currency: 'SOL', status: 'ACTIVE',
                },
            })
            // The PENDING row escrow.ts opens when it hands the buy transaction to the wallet.
            // settle has to finish this one rather than leave it pending beside a duplicate.
            const pending = await prisma.transaction.create({
                data: await auditedTransactionData({
                    chain: 'SOLANA', kind: 'PURCHASE', status: 'PENDING', userId: buyerUserId,
                    walletAddress: BUYER, amount: '1.10', assetId: soldAsset,
                    metadata: { source: 'escrow_purchase', seller: SELLER },
                }),
            })
            return { nftId: nft.id, listingId: listing.id, pendingId: pending.id }
        })

        const settleApp = new Hono()
        settleApp.post('/settle', settle as any)
        const settleSig = bs58Encode(Buffer.alloc(64, 5))
        const settleRes = await settleApp.request('/settle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetId: soldAsset, txHash: settleSig, buyer: BUYER }),
        }, env)
        eq('settle accepts a purchase the chain confirms', settleRes.status, 200)

        const settled = await inspect(async (p) => ({
            nft: await p.nft.findUnique({ where: { id: sale.nftId } }),
            listing: await p.listing.findUnique({ where: { id: sale.listingId } }),
            sale: await p.sale.findUnique({ where: { txHash: settleSig } }),
            pending: await p.transaction.findUnique({ where: { id: sale.pendingId } }),
            purchasesForAsset: await p.transaction.count({
                where: { kind: 'PURCHASE', metadata: { path: ['assetId'], equals: soldAsset } },
            }),
        }))
        eq('ownership moves to the buyer', settled.nft?.ownerAddress, BUYER)
        eq('the listing closes as SOLD', settled.listing?.status, 'SOLD')
        eq('the listing records the closing hash', settled.listing?.closeTxHash, settleSig)
        eq('a sale row is written', settled.sale?.buyerAddress, BUYER)
        // Price comes off the listing, not off anything the caller sent.
        eq('the sale price comes from the listing', settled.sale?.price.toString(), '1.1')
        eq('the pending purchase is finished, not duplicated', settled.purchasesForAsset, 1)
        eq('it is the same row, now CONFIRMED', settled.pending?.status, 'CONFIRMED')
        eq('and it carries the settling hash', settled.pending?.txHash, settleSig)

        // The checksum covers kind, wallet, amount, chain and asset - none of which settle
        // touches - so finishing a pending row must not invalidate its audit record.
        const settledVerdict = await verifyTransactionChecksum(POSTGRES_URL, settleSig)
        if (settledVerdict.valid) ok('the settled purchase still verifies after the update')
        else fail('settling invalidated the purchase checksum', settledVerdict.message)

        // Settling the same hash twice must be idempotent, not a duplicate sale or a 500.
        const resettle = await settleApp.request('/settle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetId: soldAsset, txHash: settleSig, buyer: BUYER }),
        }, env)
        const saleCount = await inspect((p) => p.sale.count({ where: { nft: { assetId: soldAsset } } }))
        eq('settling twice does not error', resettle.status, 200)
        eq('settling twice does not write a second sale', saleCount, 1)

        // A buyer who does not hold the asset is refused, retryably. This is the check that
        // stopped an escrow PDA being recorded as a purchaser.
        const wrongBuyer = await settleApp.request('/settle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetId: soldAsset, txHash: settleSig, buyer: SELLER }),
        }, env)
        eq('a buyer the chain does not show holding the asset is refused', wrongBuyer.status, 409)

        // ---------------------------------------------------------------- medal claim
        console.log('')
        console.log('claiming a medal moves it and records the claim:')

        const vaultKp = Keypair.generate()
        const vaultAddress = vaultKp.publicKey.toBase58()
        const medalMint = ASSET(12)
        putAsset(medalMint, vaultAddress, 'Gold Medal')

        const medalEnv = {
            ...env,
            MEDAL_VAULT_PRIVATE_KEY: bs58Encode(vaultKp.secretKey),
        }

        const seeded = await withPrisma(POSTGRES_URL, async (prisma) => {
            const userId = await ensureUser(prisma, 'SOLANA', BUYER)
            const event = await prisma.event.create({
                data: { slug: 'launch-week', name: 'Launch Week', status: 'ACTIVE' },
            })
            const nft = await prisma.nft.create({
                data: {
                    chain: 'SOLANA', assetId: medalMint, mintAddress: medalMint, name: 'Gold Medal',
                    ownerAddress: vaultAddress, imageOk: true,
                },
            })
            const medal = await prisma.eventMedal.create({
                data: {
                    eventId: event.id, tier: 'GOLD', name: 'Gold Medal', requiredPoints: 100,
                    supply: 2, nftId: nft.id,
                },
            })
            await prisma.eventParticipant.create({
                data: { eventId: event.id, userId, walletAddress: BUYER, chain: 'SOLANA', points: 150 },
            })
            return { eventId: event.id, medalId: medal.id }
        })

        const medalApp = new Hono()
        medalApp.post('/events/:id/medals/:medalId/claim', claimMedal as any)
        const claim = (wallet: string) => medalApp.request(
            `/events/${seeded.eventId}/medals/${seeded.medalId}/claim`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: wallet }),
            },
            medalEnv,
        )

        const claimRes = await claim(BUYER)
        eq('an eligible wallet can claim', claimRes.status, 200)

        const claimed = await inspect(async (p) => ({
            claims: await p.medalClaim.count({ where: { medalId: seeded.medalId } }),
            claim: await p.medalClaim.findFirst({ where: { medalId: seeded.medalId } }),
            medal: await p.eventMedal.findUnique({ where: { id: seeded.medalId } }),
            nft: await p.nft.findUnique({ where: { assetId: medalMint } }),
            tx: await p.transaction.findFirst({ where: { kind: 'MEDAL_CLAIM' }, orderBy: { createdAt: 'desc' } }),
        }))
        eq('a claim row is written', claimed.claims, 1)
        eq('it records the points held at claim time', claimed.claim?.pointsAtClaim, 150)
        eq('claimedCount is incremented', claimed.medal?.claimedCount, 1)
        eq('the medal nft now belongs to the claimer', claimed.nft?.ownerAddress, BUYER)
        eq('a MEDAL_CLAIM transaction is recorded', claimed.tx?.kind, 'MEDAL_CLAIM')
        eq('the transfer was actually sent', SENT.length > 0, true)

        const medalVerdict = await verifyTransactionChecksum(POSTGRES_URL, claimed.tx!.txHash!)
        if (medalVerdict.valid) ok('the medal claim record verifies')
        else fail('the medal claim record does not verify', medalVerdict.message)

        // The unique index on (medalId, userId) is the real guard against a double claim, and it
        // has to surface as a 409 rather than a 500 from a constraint violation.
        const second = await claim(BUYER)
        eq('the same wallet cannot claim twice', second.status, 409)
        const stillOne = await inspect((p) => p.medalClaim.count({ where: { medalId: seeded.medalId } }))
        eq('and no second claim row appears', stillOne, 1)

        // Once the medal has moved, the vault no longer holds it: a different wallet claiming
        // the same medal must be told so rather than sent a transfer that cannot work.
        putAsset(medalMint, BUYER, 'Gold Medal')
        const otherWallet = await claim(SELLER)
        eq('a medal no longer in the vault is refused', otherWallet.status, 409)

        // ---------------------------------------------------------------- confirmBurn
        console.log('')
        console.log('confirmBurn removes the asset and everything that pointed at it:')

        const burnAsset = ASSET(7)
        const doomed = await withPrisma(POSTGRES_URL, async (prisma) => {
            const userId = await ensureUser(prisma, 'SOLANA', SELLER)
            const nft = await prisma.nft.create({
                data: { chain: 'SOLANA', assetId: burnAsset, name: 'Doomed', ownerAddress: SELLER, imageOk: true },
            })
            const like = await prisma.like.create({ data: { userId, nftId: nft.id } })
            // A closed listing, so the burn is allowed, plus the sale that closed it. Both are
            // the dependents the delete has to take with it.
            const listing = await prisma.listing.create({
                data: {
                    nftId: nft.id, chain: 'SOLANA', sellerAddress: SELLER, price: '2',
                    currency: 'SOL', status: 'SOLD',
                },
            })
            const soldRow = await prisma.sale.create({
                data: {
                    nftId: nft.id, listingId: listing.id, chain: 'SOLANA', sellerAddress: SELLER,
                    buyerAddress: BUYER, price: '2', currency: 'SOL', txHash: 'sale-of-doomed',
                },
            })
            return { likeId: like.id, listingId: listing.id, saleId: soldRow.id }
        })

        const burnApp = new Hono()
        burnApp.post('/confirm', confirmBurn as any)
        const burnSig = '5'.repeat(88)
        const burnRes = await burnApp.request('/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetId: burnAsset, signature: burnSig }),
        }, env)
        eq('a confirmed burn of a vanished asset succeeds', burnRes.status, 200)

        const after = await inspect(async (p) => ({
            nft: await p.nft.count({ where: { assetId: burnAsset } }),
            likes: await p.like.count({ where: { id: doomed.likeId } }),
            listings: await p.listing.count({ where: { id: doomed.listingId } }),
            sales: await p.sale.count({ where: { id: doomed.saleId } }),
            burn: await p.transaction.findUnique({ where: { txHash: burnSig } }),
        }))
        eq('the nft row is gone', after.nft, 0)
        eq('its likes cascaded', after.likes, 0)
        eq('its listing cascaded', after.listings, 0)
        eq('its sale cascaded', after.sales, 0)
        eq('a BURN transaction was recorded', after.burn?.kind, 'BURN')

        // The row survives the asset it describes - Transaction has no nftId, precisely so the
        // audit trail is not deleted along with the token.
        const burnVerdict = await verifyTransactionChecksum(POSTGRES_URL, burnSig)
        if (burnVerdict.valid) ok('the BURN record still verifies after the asset is gone')
        else fail('the BURN record does not verify', burnVerdict.message)

        // A second confirmation of the same burn must not 500; the row is simply not there.
        const again = await burnApp.request('/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetId: burnAsset, signature: burnSig }),
        }, env)
        eq('confirming the same burn twice answers 404, not 500', again.status, 404)

        await resetDatabase()
    } finally {
        await rpc.stop()
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
    console.error('db-flows-check crashed:', e)
    process.exit(1)
})
