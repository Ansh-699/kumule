// Kumule v2 API — multi-chain NFT marketplace on Solana devnet and Base Sepolia.
//
// Route shape follows one rule: marketplace reads go through nfts.ts and are chain-agnostic,
// while anything that touches a chain goes through the chain abstraction. Nothing in this file
// knows how Solana and EVM differ.

import { Hono } from 'hono'
import { Buffer } from 'buffer'
;(globalThis as any).Buffer = Buffer

import { CHAINS, CHAIN_CONFIG, EVM_CHAIN_ID } from './chains'
import { withPrisma, getConnectionString } from './db'

// marketplace reads
import { listNfts, getNft, listListings, getStats, listCollections } from './nfts'

// solana marketplace (escrow program 3ozh4TQJ..., unchanged and still deployed)
import { searchNftByAsset } from './searchnftbyasset'
import { searchNftByOwner } from './searchnftbyowner'
import { mintNft } from './mint'
import { transferNft } from './transfer'
import { listNft, buyNft, cancelListing, getListings, adminResolveEscrow } from './escrow'

// evm marketplace (read-only from the worker; writes are wallet-signed in the browser)
import { evmContracts, totalMinted, readAsset, readListing, listAllListings as evmListings, verifyEvmTransaction } from './evm'
import { verifySolanaTransaction } from './solana'

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
} from './admin'
import { verifyTransactionChecksum } from './audit'
import { openAPISpec } from './openapi'

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

app.onError((err, c) => {
    // Logged in full, returned without internals. An unhandled throw should still be a clean
    // JSON 500 rather than a Workers stack trace.
    console.error('[UNHANDLED]', err)
    return c.json({ error: 'Internal error', message: err.message }, 500)
})

app.notFound((c) => c.json({ error: 'Not found', path: new URL(c.req.url).pathname }, 404))

// ---------------------------------------------------------------- system

app.get('/health', (c) => c.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() }))

app.get('/api/chains', (c) =>
    c.json({
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

app.get('/debug/db', async (c) => {
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
app.get('/api/listings', listListings)
app.get('/api/collections', listCollections)
app.get('/api/stats', getStats)

// ---------------------------------------------------------------- solana chain ops

app.get('/api/solana/asset', searchNftByAsset)
app.get('/api/solana/owner', searchNftByOwner)
app.post('/api/solana/mint', mintNft)
app.post('/api/solana/transfer', transferNft)
app.post('/api/solana/list', listNft)
app.post('/api/solana/buy', buyNft)
app.post('/api/solana/cancel', cancelListing)
app.get('/api/solana/escrows', getListings)

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
app.post('/api/albums', createAlbum)
app.put('/api/albums/:id', updateAlbum)
app.delete('/api/albums/:id', deleteAlbum)
app.post('/api/albums/:id/tracks', addTrack)
app.put('/api/albums/:id/tracks/:trackId', updateTrack)
app.delete('/api/albums/:id/tracks/:trackId', deleteTrack)
app.get('/api/albums/:id/tracks/:trackId/metadata', generateTrackMetadata)

// ---------------------------------------------------------------- storage

app.post('/api/upload/image', uploadImageToR2)
app.post('/api/upload/files', uploadFilesToR2)
app.post('/api/upload/metadata', uploadMetadataToR2)
app.post('/api/upload/audio', uploadAudioToR2)
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

app.post('/api/admin/events', adminAuth, createEvent)
app.delete('/api/admin/events/:id', adminAuth, deleteEvent)
// Points are mocked and caller-supplied, which is exactly why this sits behind adminAuth:
// points convert straight into a real NFT leaving the vault.
app.post('/api/admin/events/:id/points', adminAuth, grantPoints)
app.post('/api/admin/events/:id/medals/mint', adminAuth, mintMedals)
app.get('/api/admin/events/:id/claims', adminAuth, listClaims)

app.post('/api/admin/escrow/resolve', adminAuth, adminResolveEscrow)

app.get('/api/admin/audit/:identifier', adminAuth, async (c) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)
    const result = await verifyTransactionChecksum(connectionString, c.req.param('identifier'))
    return c.json(result, result.valid ? 200 : 400)
})

export default app
