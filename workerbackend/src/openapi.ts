// OpenAPI description of the v2 API.
//
// Rewritten from scratch: the v1 spec was 1,957 lines describing Coinbase Commerce charges,
// disputes and two reward systems, none of which exist any more. Documentation that lies is
// worse than none, so this covers only routes the router actually mounts.

import { EVM_CHAIN_ID } from './chains'

const chainParam = {
    name: 'chain',
    in: 'query',
    description: 'Filter by chain. Accepts SOLANA, SOL, ETHEREUM, ETH, EVM or BASE.',
    schema: { type: 'string', enum: ['SOLANA', 'ETHEREUM'] },
}
const pagingParams = [
    { name: 'limit', in: 'query', schema: { type: 'integer', default: 24, maximum: 100 } },
    { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
]

const ok = (description: string) => ({ '200': { description } })
const adminSecured = [{ AdminApiKey: [] }]

export const openAPISpec = {
    openapi: '3.0.3',
    info: {
        title: 'Kumule API',
        version: '2.0.0',
        description: [
            'Multi-chain NFT marketplace across Solana devnet and Base Sepolia.',
            '',
            '**Asset identity.** Every asset has one `assetId`: the mint address on Solana, and',
            '`<contract>:<tokenId>` lowercased on EVM. Marketplace reads never branch on chain.',
            '',
            '**Money.** All amounts are decimal strings, never JSON numbers. A float cannot',
            'represent 0.1 exactly, and prices are money.',
            '',
            '**Writes on EVM.** The worker holds no user EVM key. Listing, buying and minting on',
            'Base Sepolia are signed in the browser; these endpoints read chain state and record',
            'what landed.',
            '',
            '**Admin.** `/api/admin/*` requires the `X-Admin-API-Key` header. With no key',
            'configured the admin surface returns 503 rather than falling back to a default.',
        ].join('\n'),
    },
    servers: [
        { url: 'https://kumele-backend.ansht.workers.dev', description: 'Production' },
        { url: 'http://localhost:8787', description: 'Local wrangler dev' },
    ],
    components: {
        securitySchemes: {
            AdminApiKey: { type: 'apiKey', in: 'header', name: 'X-Admin-API-Key' },
        },
        schemas: {
            Nft: {
                type: 'object',
                properties: {
                    assetId: { type: 'string', description: 'Cross-chain identity' },
                    chain: { type: 'string', enum: ['SOLANA', 'ETHEREUM'] },
                    chainId: { type: 'integer', nullable: true, example: EVM_CHAIN_ID },
                    name: { type: 'string' },
                    imageUrl: { type: 'string', nullable: true },
                    category: { type: 'string' },
                    ownerAddress: { type: 'string' },
                    likeCount: { type: 'integer' },
                    listing: {
                        type: 'object',
                        nullable: true,
                        properties: {
                            price: { type: 'string', description: 'Decimal string' },
                            currency: { type: 'string', enum: ['SOL', 'ETH'] },
                        },
                    },
                },
            },
            Error: {
                type: 'object',
                properties: { error: { type: 'string' }, details: { type: 'string' } },
            },
        },
    },
    tags: [
        { name: 'System' },
        { name: 'Marketplace', description: 'Chain-agnostic reads' },
        { name: 'Solana', description: 'Solana devnet operations' },
        { name: 'Ethereum', description: 'Base Sepolia reads' },
        { name: 'Events', description: 'Events and medal rewards' },
        { name: 'Music' },
        { name: 'Storage' },
        { name: 'Admin' },
    ],
    paths: {
        '/health': { get: { tags: ['System'], summary: 'Liveness', responses: ok('Healthy') } },
        '/api/chains': {
            get: { tags: ['System'], summary: 'Supported chains and contracts', responses: ok('Chain list') },
        },
        '/debug/db': {
            get: { tags: ['System'], summary: 'Row counts per table', responses: ok('Counts') },
        },

        '/api/nfts': {
            get: {
                tags: ['Marketplace'],
                summary: 'Browse NFTs across both chains',
                parameters: [
                    chainParam,
                    { name: 'category', in: 'query', schema: { type: 'string', enum: ['ART', 'PFP', 'GAMING', 'PHOTOGRAPHY', 'MUSIC', 'UTILITY', 'VIRTUAL_WORLDS', 'OTHER'] } },
                    { name: 'owner', in: 'query', schema: { type: 'string' }, description: 'Either chain address form' },
                    { name: 'collection', in: 'query', schema: { type: 'string' }, description: 'id or slug' },
                    { name: 'minPrice', in: 'query', schema: { type: 'string' } },
                    { name: 'maxPrice', in: 'query', schema: { type: 'string' } },
                    { name: 'listedOnly', in: 'query', schema: { type: 'boolean' } },
                    { name: 'search', in: 'query', schema: { type: 'string' } },
                    { name: 'sort', in: 'query', schema: { type: 'string', enum: ['recent', 'oldest', 'most_liked', 'name'] } },
                    ...pagingParams,
                ],
                responses: ok('Paged NFTs, each carrying its chain'),
            },
        },
        '/api/nfts/{assetId}': {
            get: {
                tags: ['Marketplace'],
                summary: 'One asset with listing and sale history',
                parameters: [{ name: 'assetId', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { ...ok('Asset detail'), '404': { description: 'Not found' } },
            },
        },
        '/api/listings': {
            get: {
                tags: ['Marketplace'],
                summary: 'Active listings on both chains',
                parameters: [chainParam, ...pagingParams],
                responses: ok('Paged listings'),
            },
        },
        '/api/collections': {
            get: {
                tags: ['Marketplace'],
                summary: 'Collections with floor price and volume',
                parameters: [chainParam, { name: 'verified', in: 'query', schema: { type: 'boolean' } }, ...pagingParams],
                responses: ok('Collections'),
            },
        },
        '/api/stats': {
            get: {
                tags: ['Marketplace'],
                summary: 'Marketplace totals and per-chain volume',
                parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', default: 30 } }],
                responses: ok('Stats'),
            },
        },

        '/api/solana/asset': {
            get: {
                tags: ['Solana'],
                summary: 'Read an MPL Core asset from chain',
                parameters: [{ name: 'asset', in: 'query', required: true, schema: { type: 'string' } }],
                responses: ok('Asset'),
            },
        },
        '/api/solana/owner': {
            get: {
                tags: ['Solana'],
                summary: 'Assets held by a wallet',
                parameters: [{ name: 'owner', in: 'query', required: true, schema: { type: 'string' } }],
                responses: ok('Assets'),
            },
        },
        '/api/solana/mint': {
            post: {
                tags: ['Solana'],
                summary: 'Build an unsigned mint transaction',
                description:
                    'Returns base64 for the wallet to sign. When MINT_FEE_LAMPORTS is set, a ' +
                    '`feeTxSignature` proving payment to the treasury is required and is verified ' +
                    'on chain; the signature is single-use.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['uri', 'name', 'owner'],
                                properties: {
                                    uri: { type: 'string' },
                                    name: { type: 'string' },
                                    owner: { type: 'string' },
                                    collection: { type: 'string' },
                                    feeTxSignature: { type: 'string' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    ...ok('Unsigned transaction'),
                    '402': { description: 'Mint fee missing or unverified' },
                    '409': { description: 'Duplicate metadata URI, or fee signature reused' },
                },
            },
        },
        '/api/solana/list': {
            post: { tags: ['Solana'], summary: 'List into the escrow program', responses: ok('Unsigned transaction') },
        },
        '/api/solana/buy': {
            post: { tags: ['Solana'], summary: 'Buy from escrow', responses: ok('Unsigned transaction') },
        },
        '/api/solana/cancel': {
            post: { tags: ['Solana'], summary: 'Cancel a listing', responses: ok('Unsigned transaction') },
        },
        '/api/solana/transfer': {
            post: { tags: ['Solana'], summary: 'Transfer an asset', responses: ok('Unsigned transaction') },
        },
        '/api/solana/escrows': {
            get: { tags: ['Solana'], summary: 'Escrow accounts read from chain', responses: ok('Escrows') },
        },
        '/api/solana/verify/{signature}': {
            get: {
                tags: ['Solana'],
                summary: 'Confirm a signature landed and did not error',
                description: 'Fails closed: an unreachable RPC reports unverified, never verified.',
                parameters: [{ name: 'signature', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { ...ok('Verified'), '400': { description: 'Not verified' } },
            },
        },

        '/api/evm/contracts': {
            get: { tags: ['Ethereum'], summary: 'Deployed proxy addresses', responses: ok('Addresses') },
        },
        '/api/evm/supply': {
            get: { tags: ['Ethereum'], summary: 'Total minted', responses: ok('Supply') },
        },
        '/api/evm/asset/{tokenId}': {
            get: {
                tags: ['Ethereum'],
                summary: 'Owner and tokenURI for a token',
                parameters: [{ name: 'tokenId', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { ...ok('Asset'), '404': { description: 'Token does not exist' } },
            },
        },
        '/api/evm/listings': {
            get: {
                tags: ['Ethereum'],
                summary: 'Marketplace listings read from chain',
                parameters: [{ name: 'activeOnly', in: 'query', schema: { type: 'boolean', default: true } }],
                responses: ok('Listings'),
            },
        },
        '/api/evm/listings/{listingId}': {
            get: {
                tags: ['Ethereum'],
                summary: 'One listing',
                parameters: [{ name: 'listingId', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { ...ok('Listing'), '404': { description: 'Does not exist' } },
            },
        },
        '/api/evm/verify/{txHash}': {
            get: {
                tags: ['Ethereum'],
                summary: 'Confirm a transaction succeeded',
                parameters: [{ name: 'txHash', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { ...ok('Verified'), '400': { description: 'Not verified' } },
            },
        },

        '/api/events': { get: { tags: ['Events'], summary: 'List events with medal tiers', responses: ok('Events') } },
        '/api/events/{id}': {
            get: {
                tags: ['Events'],
                summary: 'Event detail, with this wallet’s progress when ?wallet= is given',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'id or slug' },
                    { name: 'wallet', in: 'query', schema: { type: 'string' } },
                ],
                responses: { ...ok('Event with per-medal claimability'), '404': { description: 'Not found' } },
            },
        },
        '/api/events/{id}/leaderboard': {
            get: { tags: ['Events'], summary: 'Participants ranked by points', responses: ok('Leaderboard') },
        },
        '/api/events/{id}/join': {
            post: { tags: ['Events'], summary: 'Join an event (idempotent)', responses: ok('Joined') },
        },
        '/api/events/{id}/medals/{medalId}/claim': {
            post: {
                tags: ['Events'],
                summary: 'Claim a medal into your wallet',
                description:
                    'The vault key signs the transfer, since the asset is held by the vault and ' +
                    'a user wallet cannot authorise moving it. The claim is recorded only after ' +
                    'the transfer confirms.',
                responses: {
                    ...ok('Claimed, with txHash'),
                    '403': { description: 'Not enough points' },
                    '409': { description: 'Already claimed, unminted, or supply exhausted' },
                    '503': { description: 'Vault key not configured' },
                },
            },
        },

        '/api/albums': {
            get: { tags: ['Music'], summary: 'List albums', responses: ok('Albums') },
            post: { tags: ['Music'], summary: 'Create an album', responses: ok('Created') },
        },
        '/api/albums/{id}': {
            get: { tags: ['Music'], summary: 'Album with tracks', responses: ok('Album') },
            put: { tags: ['Music'], summary: 'Update an album', responses: ok('Updated') },
            delete: { tags: ['Music'], summary: 'Delete an album and its tracks', responses: ok('Deleted') },
        },
        '/api/albums/{id}/tracks': {
            post: { tags: ['Music'], summary: 'Add a track', responses: ok('Created') },
        },

        '/api/upload/image': {
            post: {
                tags: ['Storage'],
                summary: 'Upload an image to R2',
                description: 'multipart/form-data. A non-multipart body is rejected with 400.',
                responses: { ...ok('Public URL'), '400': { description: 'Wrong content type or bad file' } },
            },
        },
        '/api/upload/metadata': {
            post: { tags: ['Storage'], summary: 'Upload metadata JSON to R2', responses: ok('Public URL') },
        },
        '/api/upload/audio': {
            post: { tags: ['Storage'], summary: 'Upload audio to R2', responses: ok('Public URL') },
        },
        '/cdn/audio/{filename}': {
            get: { tags: ['Storage'], summary: 'Stream audio, supports range requests', responses: ok('Audio') },
        },

        '/api/admin/overview': {
            get: {
                tags: ['Admin'],
                summary: 'Totals, per-chain split, categories, recent activity',
                security: adminSecured,
                responses: { ...ok('Overview'), '401': { description: 'Bad key' }, '503': { description: 'No key configured' } },
            },
        },
        '/api/admin/users': {
            get: { tags: ['Admin'], summary: 'Users with wallets on both chains', security: adminSecured, responses: ok('Users') },
        },
        '/api/admin/listings': {
            get: { tags: ['Admin'], summary: 'All listings, any status', security: adminSecured, responses: ok('Listings') },
        },
        '/api/admin/transactions': {
            get: { tags: ['Admin'], summary: 'Transaction log', security: adminSecured, responses: ok('Transactions') },
        },
        '/api/admin/nfts/broken': {
            get: {
                tags: ['Admin'],
                summary: 'Assets whose image never resolved',
                security: adminSecured,
                responses: ok('Broken assets'),
            },
        },
        '/api/admin/nfts/{assetId}/hide': {
            post: {
                tags: ['Admin'],
                summary: 'Hide or unhide an asset',
                description: 'Hidden rather than deleted, so an asset is recoverable if its metadata host returns.',
                security: adminSecured,
                responses: ok('Updated'),
            },
        },
        '/api/admin/events': {
            post: {
                tags: ['Admin'],
                summary: 'Create an event with Gold/Silver/Bronze tiers',
                description: 'Thresholds must satisfy GOLD >= SILVER >= BRONZE.',
                security: adminSecured,
                responses: { '201': { description: 'Created' }, '400': { description: 'Invalid tier config' } },
            },
        },
        '/api/admin/events/{id}/points': {
            post: {
                tags: ['Admin'],
                summary: 'Grant points to a participant',
                description:
                    'Points are caller-supplied and unverified by design, which is exactly why ' +
                    'this is admin-only: points convert directly into a real NFT leaving the vault.',
                security: adminSecured,
                responses: ok('Updated points'),
            },
        },
        '/api/admin/events/{id}/medals/mint': {
            post: {
                tags: ['Admin'],
                summary: 'Mint unminted medals into the vault',
                security: adminSecured,
                responses: { ...ok('Mint results'), '503': { description: 'Vault key not configured' } },
            },
        },
        '/api/admin/events/{id}/claims': {
            get: { tags: ['Admin'], summary: 'Claims for an event', security: adminSecured, responses: ok('Claims') },
        },
        '/api/admin/audit/{identifier}': {
            get: {
                tags: ['Admin'],
                summary: 'Verify a transaction checksum by txHash or row id',
                security: adminSecured,
                responses: { ...ok('Valid'), '400': { description: 'Mismatch or missing checksum' } },
            },
        },
    },
} as const
