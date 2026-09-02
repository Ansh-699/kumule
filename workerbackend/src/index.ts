// Kumule v2 API — multi-chain NFT marketplace on Solana devnet and Base Sepolia.
//
// Route shape follows one rule: marketplace reads go through nfts.ts and are chain-agnostic,
// while anything that touches a chain goes through the chain abstraction. Nothing in this file
// knows how Solana and EVM differ.

import { Hono, type Context } from 'hono'

// Buffer is not imported or polyfilled here. The nodejs_compat flag at this compatibility date
// (2024-09-23 or later) puts a working Buffer on globalThis already - verified in workerd, not
// assumed - so `import { Buffer } from 'buffer'` was resolving to the userland npm package and
// bundling ~50KB of shim to shadow a global that was already correct.

import { CHAINS, CHAIN_CONFIG, EVM_CHAIN_ID } from './chains'
import { withPrisma, getConnectionString } from './db'

// marketplace reads
import { listNfts, getNft, listListings, getStats, listCollections, toggleLike, getLikeState } from './nfts'

// solana marketplace (escrow program 3ozh4TQJ..., unchanged and still deployed)
import { searchNftByAsset } from './searchnftbyasset'
import { searchNftByOwner } from './searchnftbyowner'
import { mintNft } from './mint'
import { transferNft } from './transfer'
import { listNft, syncListing, buyNft, cancelListing, getListings, adminResolveEscrow } from './escrow'
import { burnNft, confirmBurn } from './burn'

// evm marketplace (read-only from the worker; writes are wallet-signed in the browser)
import { evmContracts, totalMinted, readAsset, readListing, listAllListings as evmListings, verifyEvmTransaction } from './evm'
import { verifySolanaTransaction } from './solana'

// post-transaction reconciliation: what makes a landed purchase or mint visible
import { settle, indexEvmToken, indexEvmListing } from './settle'

// events and medals
import {
    createEvent, listEvents, getEvent, joinEvent, deleteEvent,
    grantPoints, mintMedals, claimMedal, listClaims, getLeaderboard,
} from './medals'

// music
import {
    createAlbum, listAlbums, getAlbum, updateAlbum, deleteAlbum,
    addTrack, updateTrack, deleteTrack, generateTrackMetadata,
} from './album'

// storage
import {
    uploadImageToR2, uploadFilesToR2, uploadMetadataToR2, uploadAudioToR2,
    serveImageFromR2, serveMetadataFromR2, serveAudioFromR2,
} from './upload'

// admin
import {
    adminAuth, getAdminOverview, listUsers, listAllListings as adminListings,
    listTransactions, setNftHidden, listBrokenNfts,
    resolveNftMetadata, resolveMissingMetadata, indexEvmTokens, indexEvmListings, replaceR2Object,
} from './admin'
import { verifyTransactionChecksum } from './audit'
import { openAPISpec } from './openapi'

// stripe rail: fiat in, NFT out. The only mint path that runs while the buyer is away.
import { getFeeQuote } from './web3fees'
import {
    createIntent, getPayment, stripeWebhook, scheduled, featureFlags,
    adminListPayments, adminRefundPayment,
} from './payments'
import { mintFromKumele } from './kumeleMint'
import { directCryptoEnabled } from './config'

const app = new Hono<{ Bindings: CloudflareBindings }>()

// ---------------------------------------------------------------- middleware

/**
 * Nothing here is cookie-authenticated: the admin key travels in a header and wallets sign in
 * the browser. So a plain wildcard is both correct and safe. Reflecting the caller's Origin
 * alongside Allow-Credentials, as v1 did, let any site make credentialed calls.
 */
app.use('*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*')
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-API-Key')
    if (c.req.method === 'OPTIONS') return c.body(null, 204)
    await next()
})

/**
 * Direct-crypto routes are dormant for the Stripe MVP.
 *
 * A wrapper rather than conditional registration, because `app` is built at module scope
 * where `env` does not exist yet - in Workers the environment arrives per request. Every
 * handler below stays imported, compiled and covered by its own check; only the route is
 * closed, and one variable reopens it.
 *
 * 404 rather than 403: as far as this deployment is concerned the endpoint is not there.
 */
type ChainOp = (c: Context<{ Bindings: CloudflareBindings }>) => Response | Promise<Response>

const directCrypto =
    (handler: ChainOp) =>
    async (c: Context<{ Bindings: CloudflareBindings }>): Promise<Response> =>
        directCryptoEnabled(c.env)
            ? handler(c)
            : c.json(
                {
                    error: 'Direct crypto payments are disabled for this deployment',
                    hint: 'NFTs are minted through card payment; see /api/v1/web3/fees/quote',
                },
                404
            )

app.onError((err, c) => {
    // Logged in full, returned without internals. An unhandled throw should still be a clean
    // JSON 500 rather than a Workers stack trace.
    console.error('[UNHANDLED]', err)
    return c.json({ error: 'Internal error', message: err.message }, 500)
})

app.notFound((c) => c.json({ error: 'Not found', path: new URL(c.req.url).pathname }, 404))

// ---------------------------------------------------------------- system

app.get('/health', (c) => c.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() }))

// features rides along here rather than on a route of its own: the frontend already needs
// this response before it can render a chain, and a Buy button that 404s is worse than one
// that was never drawn.
app.get('/api/chains', (c) =>
    c.json({
        features: featureFlags(c.env),
        data: CHAINS.map((chain) => ({
            chain,
            label: CHAIN_CONFIG[chain].label,
            currency: CHAIN_CONFIG[chain].currency,
            decimals: CHAIN_CONFIG[chain].decimals,
            ...(chain === 'ETHEREUM'
                ? { chainId: EVM_CHAIN_ID, network: 'Base Sepolia', contracts: evmContracts(c.env) }
                : { cluster: 'devnet' }),
        })),
    })
)

// Behind the admin key. It leaks no secret and no row content, but it is an unauthenticated
// read of live business metrics - user count, sales, inventory - and /api/admin/overview
// already gives an authenticated operator a superset of it.
app.get('/debug/db', adminAuth, async (c) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ ok: false, error: 'Database not configured' }, 503)
    try {
        const counts = await withPrisma(connectionString, async (prisma) => ({
            users: await prisma.user.count(),
            wallets: await prisma.wallet.count(),
            nfts: await prisma.nft.count(),
            listings: await prisma.listing.count(),
            sales: await prisma.sale.count(),
            events: await prisma.event.count(),
        }))
        return c.json({ ok: true, ...counts })
    } catch (e: any) {
        console.error('debug/db failed:', e)
        return c.json({ ok: false, error: e?.message }, 500)
    }
})

app.get('/openapi.json', (c) => c.json(openAPISpec))

// ---------------------------------------------------------------- marketplace reads

app.get('/api/nfts', listNfts)
app.get('/api/nfts/:assetId', getNft)
app.post('/api/nfts/:assetId/like', toggleLike)
app.get('/api/nfts/:assetId/liked', getLikeState)
app.get('/api/listings', listListings)
app.get('/api/collections', listCollections)
app.get('/api/stats', getStats)

// Records a purchase that already landed. Without this a completed buy left the NFT on sale,
// still owned by the seller, and platform volume stuck at zero on both chains.
// NOT behind the direct-crypto flag, deliberately. settle records a purchase that has
// already landed on chain - it re-reads ownership and writes only what actually happened, so
// it cannot create value - and Base trading stays live in this deployment. Gating it would
// leave every EVM purchase succeeding on chain and invisible in the marketplace, which is the
// exact bug this endpoint was added to fix.
app.post('/api/settle', settle)

// ---------------------------------------------------------------- stripe rail
//
// Kumele's wallet pays the chain; the buyer reimburses it as a line on a card payment. The
// mint runs after payment_intent.succeeded and never before.

app.get('/api/v1/web3/fees/quote', getFeeQuote)
app.post('/api/v1/payments/intent', createIntent)
// A capability URL for the checkout page to poll. Holds no secret and no mint address until
// the asset exists.
app.get('/api/v1/payments/:paymentId', getPayment)
// Authenticated by Stripe's signature over the raw body, not by an API key. Deliberately not
// behind adminAuth: Stripe cannot send one, and a shared key in a webhook would be worse
// than the signature it replaced.
app.post('/api/v1/stripe/webhook', stripeWebhook)
// Kumele's own backend (api.kumele.com) already collected payment on ITS OWN Stripe
// integration and calls in here to get the NFT minted. Authenticated by a shared-secret
// HMAC signature (X-Kumele-Signature/X-Kumele-Timestamp), not by adminAuth - a different
// service, a different key. See docs/kumele-mint-service.md.
app.post('/api/v1/mint', mintFromKumele)

// ---------------------------------------------------------------- solana chain ops

app.get('/api/solana/asset', searchNftByAsset)
app.get('/api/solana/owner', searchNftByOwner)
app.post('/api/solana/mint', directCrypto(mintNft))
app.post('/api/solana/transfer', transferNft)
app.post('/api/solana/list', directCrypto(listNft))
// Build, then sync. Listing rows are written only from what the escrow account actually says,
// so dismissing a wallet prompt no longer advertises an NFT nobody can buy - or hides one that
// is still for sale. Covers both listing and cancelling.
app.post('/api/solana/listing/sync', directCrypto(syncListing))
app.post('/api/solana/buy', directCrypto(buyNft))
app.post('/api/solana/cancel', directCrypto(cancelListing))
app.get('/api/solana/escrows', directCrypto(getListings))
// Burning is two steps: build an unsigned transaction, then confirm it landed before the row
// is removed. The worker holds no user key, so only the owner's wallet can authorise it.
app.post('/api/solana/burn', burnNft)
app.post('/api/solana/burn/confirm', confirmBurn)

app.get('/api/solana/verify/:signature', async (c) => {
    const ok = await verifySolanaTransaction(c.env, c.req.param('signature'))
    return c.json({ verified: ok, chain: 'SOLANA' }, ok ? 200 : 400)
})

// ---------------------------------------------------------------- evm chain ops (read-only)

app.get('/api/evm/contracts', (c) =>
    c.json({ chainId: EVM_CHAIN_ID, network: 'Base Sepolia', ...evmContracts(c.env) })
)

app.get('/api/evm/supply', async (c) =>
    c.json({ totalMinted: (await totalMinted(c.env)).toString() })
)

app.get('/api/evm/asset/:tokenId', async (c) => {
    const raw = c.req.param('tokenId')
    if (!/^\d+$/.test(raw)) return c.json({ error: 'tokenId must be a non-negative integer' }, 400)
    const asset = await readAsset(c.env, evmContracts(c.env).nft, BigInt(raw))
    return asset ? c.json(asset) : c.json({ error: 'Token does not exist' }, 404)
})

app.get('/api/evm/listings', async (c) => {
    const activeOnly = c.req.query('activeOnly') !== 'false'
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200)
    const data = await evmListings(c.env, { limit, activeOnly })
    return c.json({ data, count: data.length })
})

app.get('/api/evm/listings/:listingId', async (c) => {
    const raw = c.req.param('listingId')
    if (!/^\d+$/.test(raw)) return c.json({ error: 'listingId must be a non-negative integer' }, 400)
    const listing = await readListing(c.env, BigInt(raw))
    return listing ? c.json(listing) : c.json({ error: 'Listing does not exist' }, 404)
})

// The worker never signs on Base, so a mint left no row and the token was invisible to the
// marketplace. The token id is read out of the mint receipt, so this grants the caller nothing.
app.post('/api/evm/index-token', indexEvmToken)
app.post('/api/evm/index-listing', indexEvmListing)

app.get('/api/evm/verify/:txHash', async (c) => {
    const ok = await verifyEvmTransaction(c.env, c.req.param('txHash'))
    return c.json({ verified: ok, chain: 'ETHEREUM', chainId: EVM_CHAIN_ID }, ok ? 200 : 400)
})

// ---------------------------------------------------------------- events and medals

app.get('/api/events', listEvents)
app.get('/api/events/:id', getEvent)
app.get('/api/events/:id/leaderboard', getLeaderboard)
app.post('/api/events/:id/join', joinEvent)
app.post('/api/events/:id/medals/:medalId/claim', claimMedal)

// ---------------------------------------------------------------- music

app.get('/api/albums', listAlbums)
app.get('/api/albums/:id', getAlbum)
app.post('/api/albums', adminAuth, createAlbum)
app.put('/api/albums/:id', adminAuth, updateAlbum)
app.delete('/api/albums/:id', adminAuth, deleteAlbum)
app.post('/api/albums/:id/tracks', adminAuth, addTrack)
app.put('/api/albums/:id/tracks/:trackId', adminAuth, updateTrack)
app.delete('/api/albums/:id/tracks/:trackId', adminAuth, deleteTrack)
app.get('/api/albums/:id/tracks/:trackId/metadata', generateTrackMetadata)

// ---------------------------------------------------------------- storage

app.post('/api/upload/image', uploadImageToR2)
app.post('/api/upload/files', adminAuth, uploadFilesToR2)
app.post('/api/upload/metadata', uploadMetadataToR2)
app.post('/api/upload/audio', adminAuth, uploadAudioToR2)
app.get('/cdn/images/:filename', serveImageFromR2)
app.get('/cdn/metadata/:filename', serveMetadataFromR2)
app.get('/cdn/audio/:filename', serveAudioFromR2)

// ---------------------------------------------------------------- admin

app.get('/api/admin/overview', adminAuth, getAdminOverview)
app.get('/api/admin/users', adminAuth, listUsers)
app.get('/api/admin/listings', adminAuth, adminListings)
app.get('/api/admin/transactions', adminAuth, listTransactions)
app.get('/api/admin/nfts/broken', adminAuth, listBrokenNfts)
app.post('/api/admin/nfts/:assetId/hide', adminAuth, setNftHidden)
// Repair paths for assets whose metadata was never resolved, or whose host was down at mint.
app.post('/api/admin/nfts/resolve-missing', adminAuth, resolveMissingMetadata)
app.post('/api/admin/nfts/:assetId/resolve', adminAuth, resolveNftMetadata)
// The worker never signs EVM transactions, so a Base mint leaves no row until this runs.
app.post('/api/admin/evm/index', adminAuth, indexEvmTokens)
// Separate from the token pass: together they exceed the 50-subrequest budget per request.
app.post('/api/admin/evm/index-listings', adminAuth, indexEvmListings)
// Overwrite an asset's bytes in place. The on-chain URI cannot change, but what it serves can.
app.put('/api/admin/r2/:folder/:filename', adminAuth, replaceR2Object)

app.post('/api/admin/events', adminAuth, createEvent)
app.delete('/api/admin/events/:id', adminAuth, deleteEvent)
// Points are mocked and caller-supplied, which is exactly why this sits behind adminAuth:
// points convert straight into a real NFT leaving the vault.
app.post('/api/admin/events/:id/points', adminAuth, grantPoints)
app.post('/api/admin/events/:id/medals/mint', adminAuth, mintMedals)
app.get('/api/admin/events/:id/claims', adminAuth, listClaims)

app.post('/api/admin/escrow/resolve', adminAuth, directCrypto(adminResolveEscrow))

// Paid but unminted is the one state that costs a customer real money, so it gets a place to
// be seen and a button to undo it.
app.get('/api/admin/payments', adminAuth, adminListPayments)
app.post('/api/admin/payments/:paymentId/refund', adminAuth, adminRefundPayment)

app.get('/api/admin/audit/:identifier', adminAuth, async (c) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)
    const result = await verifyTransactionChecksum(connectionString, c.req.param('identifier'))
    // A check that could not run is not the caller's mistake, and answering 400 invited
    // reading it as "this row is fine, your request was wrong". 503 says the audit is
    // unavailable; 404 says no such row; 400 stays for a row that genuinely fails.
    const status =
        result.status === 'error' ? 503 : result.status === 'not_found' ? 404 : result.valid ? 200 : 400
    return c.json(result, status)
})

// Named as well as default. The default export is now a handler object so the cron trigger
// has somewhere to land, and auth-parity-check.ts calls app.request(...) - which only exists
// on the Hono instance itself.
export { app }

export default {
    fetch: app.fetch,
    // Sweeps mint jobs that the webhook's waitUntil did not finish, and refunds the ones that
    // never can. This is the guarantee; the inline kick is only the fast path.
    scheduled,
} satisfies ExportedHandler<CloudflareBindings>
