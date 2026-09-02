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
        { name: 'Payments', description: 'Stripe rail: card payment in, minted NFT out' },
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
        '/openapi.json': {
            get: { tags: ['System'], summary: 'This specification', responses: ok('OpenAPI document') },
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
        '/api/nfts/{assetId}/like': {
            post: {
                tags: ['Marketplace'],
                summary: 'Toggle a like for this asset from a wallet',
                parameters: [{ name: 'assetId', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { ...ok('Like toggled'), '404': { description: 'NFT not found' } },
            },
        },
        '/api/nfts/{assetId}/liked': {
            get: {
                tags: ['Marketplace'],
                summary: 'Whether a wallet already liked this asset',
                parameters: [
                    { name: 'assetId', in: 'path', required: true, schema: { type: 'string' } },
                    { name: 'wallet', in: 'query', schema: { type: 'string' } },
                ],
                responses: ok('Like state'),
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
        '/api/v1/web3/fees/quote': {
            get: {
                tags: ['Payments'],
                summary: 'Price the blockchain processing fee for a mint',
                description:
                    'Kumele\'s platform wallet pays the Solana cost; this is the estimate the buyer ' +
                    'reimburses on the card payment. Covers the signature fee, the priority fee and ' +
                    'the asset account\'s rent exemption - rent is about 200x the transaction fee and ' +
                    'is the dominant term. Persists the quote so the charge is reproducible later.',
                parameters: [
                    {
                        name: 'operation', in: 'query', required: true,
                        schema: { type: 'string', enum: ['nft_mint'] },
                    },
                    {
                        name: 'chain', in: 'query', required: true,
                        schema: { type: 'string', enum: ['solana'] },
                    },
                    {
                        name: 'quantity', in: 'query',
                        schema: { type: 'integer', default: 1, minimum: 1, maximum: 50 },
                    },
                ],
                responses: {
                    ...ok('A quote, valid until expires_at'),
                    '400': { description: 'Unsupported operation, chain or quantity' },
                    '503': { description: 'Database not configured' },
                },
            },
        },
        '/api/v1/payments/intent': {
            post: {
                tags: ['Payments'],
                summary: 'Start a card payment for a mint',
                description:
                    'Every amount is derived server-side from the quote row; the body contributes only ' +
                    'a quote id, a destination wallet and what to mint. Refuses when the platform ' +
                    'wallet could not fund the mint, so a buyer is never charged for something that ' +
                    'cannot be delivered.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['quoteId', 'ownerAddress', 'name', 'metadataUri'],
                                properties: {
                                    quoteId: { type: 'string' },
                                    ownerAddress: { type: 'string', description: 'Solana address that will own the NFT' },
                                    name: { type: 'string', maxLength: 100 },
                                    metadataUri: { type: 'string', format: 'uri' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    ...ok('Client secret and the price breakdown'),
                    '400': { description: 'Invalid body, or the total is below the card minimum' },
                    '404': { description: 'Unknown quoteId' },
                    '409': { description: 'The quote has expired' },
                    '502': { description: 'Stripe refused or was unreachable' },
                    '503': { description: 'Payments unconfigured, or the mint wallet cannot fund this' },
                },
            },
        },
        '/api/v1/payments/{paymentId}': {
            get: {
                tags: ['Payments'],
                summary: 'Poll a payment and its mint',
                description:
                    'A capability URL: whoever holds the id sees the status. Carries no client secret ' +
                    'and no mint address until the asset exists on chain.',
                parameters: [{ name: 'paymentId', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { ...ok('Payment and mint status'), '404': { description: 'Unknown payment' } },
            },
        },
        '/api/v1/stripe/webhook': {
            post: {
                tags: ['Payments'],
                summary: 'Stripe event sink (not for manual calls)',
                description:
                    'Authenticated by an HMAC signature over the raw body, not by an API key. Minting ' +
                    'begins here and nowhere else. Answers 400 for a bad signature, which will never ' +
                    'verify on a retry, and 500 when the event was genuine but could not be acted on, ' +
                    'so Stripe retries it.',
                responses: {
                    ...ok('Event acknowledged'),
                    '400': { description: 'Signature verification failed' },
                    '500': { description: 'Genuine event, not yet processed - Stripe should retry' },
                    '503': { description: 'Webhook secret not configured' },
                },
            },
        },
        '/api/v1/mint': {
            post: {
                tags: ['Payments'],
                summary: "Kumele's backend hands off a paid order to be minted",
                description:
                    'Called by api.kumele.com after IT has collected payment on its own Stripe ' +
                    'integration - this worker takes no payment here. Authenticated with ' +
                    'X-Kumele-Signature / X-Kumele-Timestamp, HMAC-SHA256 over ' +
                    '`${timestamp}.${rawBody}` with a shared secret; see docs/kumele-mint-service.md ' +
                    'for the full contract. Idempotent on payment_intent_id: a repeated call never ' +
                    'mints twice, it reports the existing job\'s current state.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: [
                                    'payment_intent_id', 'order_id', 'chain',
                                    'recipient_wallet', 'quantity', 'name', 'metadata_uri',
                                ],
                                properties: {
                                    payment_intent_id: { type: 'string' },
                                    order_id: { type: 'string' },
                                    chain: { type: 'string', enum: ['solana'] },
                                    recipient_wallet: { type: 'string', description: 'Solana address that will own the NFT' },
                                    quantity: { type: 'integer', enum: [1] },
                                    name: { type: 'string' },
                                    metadata_uri: { type: 'string', format: 'uri' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    '202': { description: 'Mint queued, or already in flight from an earlier call' },
                    '200': { description: 'Replay: reports the existing minted or permanently-failed state' },
                    '400': { description: 'Invalid request body' },
                    '401': { description: 'Signature verification failed' },
                    '503': { description: 'Not configured, or the platform vault cannot fund this mint' },
                },
            },
        },
        '/api/admin/payments': {
            get: {
                tags: ['Admin'],
                summary: 'Payments, and how many are paid but unminted',
                security: adminSecured,
                parameters: [
                    {
                        name: 'status', in: 'query',
                        schema: { type: 'string', enum: ['REQUIRES_PAYMENT', 'PAID', 'FAILED', 'REFUNDED'] },
                    },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
                ],
                responses: { ...ok('Payments, with a stranded count'), '400': { description: 'Bad status' } },
            },
        },
        '/api/admin/payments/{paymentId}/refund': {
            post: {
                tags: ['Admin'],
                summary: 'Refund a payment whose mint cannot be delivered',
                description:
                    'Refuses when the mint actually succeeded - giving the money back for a delivered ' +
                    'NFT is a chargeback decision, not an operational one.',
                security: adminSecured,
                parameters: [{ name: 'paymentId', in: 'path', required: true, schema: { type: 'string' } }],
                responses: {
                    ...ok('Refunded'),
                    '404': { description: 'Unknown payment' },
                    '409': { description: 'Already refunded, or the NFT was delivered' },
                },
            },
        },
        '/api/settle': {
            post: {
                tags: ['Marketplace'],
                summary: 'Record a purchase that already landed on chain',
                responses: { ...ok('Settled'), '400': { description: 'Not confirmed, or ownership has not moved to the buyer yet' } },
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
        '/api/solana/listing/sync': {
            post: {
                tags: ['Solana'],
                summary: 'Sync a listing row from the escrow account after list or cancel',
                description: 'The escrow account on chain is the source of truth, not the caller.',
                responses: { ...ok('Synced'), '404': { description: 'NFT not found' } },
            },
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
        '/api/solana/burn': {
            post: {
                tags: ['Solana'],
                summary: 'Build an unsigned burn transaction for an owned, unlisted asset',
                responses: {
                    ...ok('Unsigned transaction'),
                    '403': { description: 'Not the recorded owner' },
                    '409': { description: 'Listed or a medal; cancel or exclude first' },
                },
            },
        },
        '/api/solana/burn/confirm': {
            post: {
                tags: ['Solana'],
                summary: 'Confirm a burn landed, then remove the row',
                description: 'Fails closed: the signature is verified on chain before anything is deleted.',
                responses: { ...ok('Removed'), '400': { description: 'Not verified' }, '404': { description: 'NFT not found' } },
            },
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
        '/api/evm/index-token': {
            post: {
                tags: ['Ethereum'],
                summary: 'Index a token minted on Base into the database',
                description: 'The token id is read from the Minted event in the transaction receipt.',
                responses: {
                    ...ok('Indexed'),
                    '400': { description: 'No mint found in that transaction' },
                    '404': { description: 'Token does not exist on chain' },
                },
            },
        },
        '/api/evm/index-listing': {
            post: {
                tags: ['Ethereum'],
                summary: 'Index a listing created on Base into the database',
                description: 'The listing id is read from the Listed event, then price and seller from the contract.',
                responses: {
                    ...ok('Indexed'),
                    '400': { description: 'No listing found in that transaction' },
                    '404': { description: 'Listing does not exist on chain' },
                    '409': { description: 'Listing is no longer active' },
                },
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
        '/api/albums/{id}/tracks/{trackId}': {
            put: { tags: ['Music'], summary: 'Update a track', responses: ok('Updated') },
            delete: { tags: ['Music'], summary: 'Delete a track', responses: ok('Deleted') },
        },
        '/api/albums/{id}/tracks/{trackId}/metadata': {
            get: { tags: ['Music'], summary: 'Metaplex-compatible metadata JSON for minting this track', responses: ok('Metadata') },
        },

        '/api/upload/image': {
            post: {
                tags: ['Storage'],
                summary: 'Upload an image to R2',
                description: 'multipart/form-data. A non-multipart body is rejected with 400.',
                responses: { ...ok('Public URL'), '400': { description: 'Wrong content type or bad file' } },
            },
        },
        '/api/upload/files': {
            post: {
                tags: ['Storage'],
                summary: 'Upload a main file plus an optional cover image to R2',
                description: 'multipart/form-data with mainFile and optional coverFile.',
                responses: { ...ok('Public URLs'), '400': { description: 'Wrong content type or bad file' } },
            },
        },
        '/api/upload/metadata': {
            post: { tags: ['Storage'], summary: 'Upload metadata JSON to R2', responses: ok('Public URL') },
        },
        '/api/upload/audio': {
            post: { tags: ['Storage'], summary: 'Upload audio to R2', responses: ok('Public URL') },
        },
        '/cdn/images/{filename}': {
            get: { tags: ['Storage'], summary: 'Serve an uploaded image from R2', responses: { ...ok('Image'), '404': { description: 'Not found' } } },
        },
        '/cdn/metadata/{filename}': {
            get: { tags: ['Storage'], summary: 'Serve uploaded metadata JSON from R2', responses: { ...ok('Metadata'), '404': { description: 'Not found' } } },
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
        '/api/admin/nfts/resolve-missing': {
            post: {
                tags: ['Admin'],
                summary: 'Re-resolve every asset whose image never came through',
                description: 'Capped per call; re-run until `remaining` reaches zero.',
                security: adminSecured,
                parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 10, maximum: 25 } }],
                responses: ok('Fixed and still-broken asset ids'),
            },
        },
        '/api/admin/nfts/{assetId}/resolve': {
            post: {
                tags: ['Admin'],
                summary: 'Re-resolve metadata for one asset',
                security: adminSecured,
                parameters: [{ name: 'assetId', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { ...ok('Updated'), '404': { description: 'NFT not found' } },
            },
        },
        '/api/admin/evm/index': {
            post: {
                tags: ['Admin'],
                summary: 'Backfill Base mints into the database by token id range',
                description:
                    'The worker never signs EVM transactions, so a mint leaves no row until this ' +
                    'runs. Paged; re-run until `remaining` is 0.',
                security: adminSecured,
                parameters: [
                    { name: 'from', in: 'query', schema: { type: 'integer', default: 1 } },
                    { name: 'to', in: 'query', schema: { type: 'integer' } },
                ],
                responses: ok('Indexed and skipped token ids'),
            },
        },
        '/api/admin/evm/index-listings': {
            post: {
                tags: ['Admin'],
                summary: 'Mirror Base marketplace listings into the database',
                description:
                    'The chain is the source of truth; bounded per call by the Worker subrequest ' +
                    'limit. Page with ?limit= until `remaining` is 0.',
                security: adminSecured,
                parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 6, maximum: 10 } }],
                responses: ok('Created, closed and skipped counts'),
            },
        },
        '/api/admin/r2/{folder}/{filename}': {
            put: {
                tags: ['Admin'],
                summary: "Replace an object's bytes in place",
                description: 'The on-chain URI cannot change, but what it serves can.',
                security: adminSecured,
                parameters: [
                    { name: 'folder', in: 'path', required: true, schema: { type: 'string', enum: ['images', 'metadata', 'audio'] } },
                    { name: 'filename', in: 'path', required: true, schema: { type: 'string' } },
                ],
                responses: {
                    ...ok('Replaced'),
                    '400': { description: 'Bad folder or filename' },
                    '404': { description: 'No existing object at that key' },
                },
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
        '/api/admin/events/{id}': {
            delete: {
                tags: ['Admin'],
                summary: 'Delete an event',
                description: 'Cascades to medals, participants and claims.',
                security: adminSecured,
                responses: { ...ok('Deleted'), '404': { description: 'Event not found' } },
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
        '/api/admin/escrow/resolve': {
            post: {
                tags: ['Admin'],
                summary: 'Admin-resolve a stuck escrow, refunding the buyer or completing the sale',
                security: adminSecured,
                responses: ok('Unsigned transaction'),
            },
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
