/**
 * OpenAPI 3.1 Specification for Kumule NFT Marketplace API
 * Includes all endpoints with request/response schemas
 */

export const openAPISpec = {
    openapi: '3.1.0',
    info: {
        title: 'Kumule NFT Marketplace API',
        version: '1.0.0',
        description: `
## Backend API service for Kumule NFT Marketplace platform

This API provides endpoints for:
- **NFT Operations**: Mint, transfer, search NFTs
- **Marketplace**: List, buy, cancel NFT listings with escrow
- **Events**: Create and join events with reward systems
- **Payments**: Coinbase Commerce and Solana payment integration
- **Rewards**: Gamification with points and NFT rewards
- **Albums**: Music NFT album management

### Authentication
- Admin endpoints require the \`X-Admin-API-Key\` header, using the key issued to you privately
- Wallet operations require Phantom/Solana wallet signing
- **No other endpoint is authenticated.** \`walletAddress\` is an unverified request parameter,
  not proof of wallet ownership — see the integration notes before relying on it for identity.

### Wallet Integration
Use the "Connect Wallet" button above to connect your Phantom wallet for signing transactions.

### Test Data
Pre-configured with real data from devnet:
- **Test Wallet**: \`anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm\`
- **Test NFT Asset**: \`F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F\`
- **Test Event ID**: \`4eaf98ff-950c-4bdb-aced-9351cf358527\`
- **Test Escrow PDA**: \`Y7WCkB2ga7LGGpYdgL6HkSDccSAw5sFdkgzVsdBBgD1\`
        `,
        contact: {
            name: 'Kumule Support',
            url: 'https://kumule.com'
        }
    },
    servers: [
        {
            url: 'https://kumele-backend.ansht.workers.dev',
            description: 'Production (Cloudflare Workers)'
        },
        {
            url: 'http://localhost:8787',
            description: 'Development'
        }
    ],
    tags: [
        { name: 'System', description: 'Health check and system endpoints' },
        { name: 'NFT', description: 'NFT minting, transfer, and search operations' },
        { name: 'Marketplace', description: 'NFT listing, buying, and escrow management' },
        { name: 'Events', description: 'Event creation, listing, and participation' },
        { name: 'Event Rewards', description: 'Event progress tracking and reward claiming' },
        { name: 'Payments', description: 'Payment processing with Coinbase Commerce' },
        { name: 'Disputes', description: 'Dispute creation and resolution' },
        { name: 'Rewards', description: 'Gamification rewards and points system' },
        { name: 'Albums', description: 'Music NFT album and track management' },
        { name: 'Upload', description: 'File upload to R2 storage' },
        { name: 'Admin', description: 'Admin-only endpoints (requires X-Admin-API-Key)' }
    ],
    paths: {
        // ==================== SYSTEM ====================
        '/health': {
            get: {
                tags: ['System'],
                summary: 'Health Check',
                description: 'Check if the API is running and healthy',
                operationId: 'healthCheck',
                responses: {
                    '200': {
                        description: 'API is healthy',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        status: { type: 'string', example: 'ok' },
                                        timestamp: { type: 'string', format: 'date-time' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/test': {
            get: {
                tags: ['System'],
                summary: 'Test Endpoint',
                operationId: 'testEndpoint',
                responses: {
                    '200': { description: 'Returns OK' }
                }
            }
        },
        '/debug/db': {
            get: {
                tags: ['System'],
                summary: 'Debug Database Connection',
                description: 'Check database connection and get basic stats',
                operationId: 'debugDatabase',
                responses: {
                    '200': {
                        description: 'Database stats',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        ok: { type: 'boolean' },
                                        userCount: { type: 'integer' },
                                        nftCount: { type: 'integer' },
                                        transactionCount: { type: 'integer' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },

        // ==================== NFT ====================
        '/': {
            get: {
                tags: ['NFT'],
                summary: 'Search NFT by Asset ID',
                description: 'Get NFT details by asset public key',
                operationId: 'searchNftByAsset',
                parameters: [
                    {
                        name: 'asset',
                        in: 'query',
                        required: true,
                        schema: { type: 'string', default: 'F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F' },
                        description: 'Solana asset public key',
                        example: 'F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F'
                    }
                ],
                responses: {
                    '200': {
                        description: 'NFT details',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/NftAsset' }
                            }
                        }
                    },
                    '400': { description: 'Missing asset parameter' },
                    '404': { description: 'NFT not found' }
                }
            }
        },
        '/owner': {
            get: {
                tags: ['NFT'],
                summary: 'Search NFTs by Owner',
                description: 'Get all NFTs owned by a wallet address',
                operationId: 'searchNftByOwner',
                parameters: [
                    {
                        name: 'owner',
                        in: 'query',
                        required: true,
                        schema: { type: 'string', default: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' },
                        description: 'Solana wallet address',
                        example: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm'
                    }
                ],
                responses: {
                    '200': {
                        description: 'List of NFTs',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'array',
                                    items: { $ref: '#/components/schemas/NftAsset' }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/mint': {
            post: {
                tags: ['NFT'],
                summary: 'Mint NFT',
                description: 'Mint a new NFT. Returns a transaction that needs to be signed by the wallet. Connect your Phantom wallet first, then fill in only the required fields (uri, name). Your wallet address will be auto-filled.',
                operationId: 'mintNft',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['uri', 'name', 'owner'],
                                properties: {
                                    uri: { type: 'string', description: 'Metadata URI (from /api/upload/metadata)', example: 'https://gateway.irys.xyz/4JFR7e2bfWE8QyPvRhnrTer7RuLpVvwty2vesQrPa9iK' },
                                    name: { type: 'string', description: 'NFT name', example: 'Test NFT' },
                                    owner: { type: 'string', description: 'Owner wallet address (connect wallet to auto-fill)', example: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' },
                                    collection: { type: 'string', description: 'Optional: Collection address (leave empty if none)', example: '' },
                                    paymentMethod: { type: 'string', enum: ['coinbase', 'solana', 'free', ''], description: 'Optional: Payment method', example: '' },
                                    chargeId: { type: 'string', description: 'Optional: Coinbase charge ID', example: '' }
                                }
                            },
                            example: {
                                uri: 'https://gateway.irys.xyz/4JFR7e2bfWE8QyPvRhnrTer7RuLpVvwty2vesQrPa9iK',
                                name: 'Test NFT',
                                owner: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm'
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Mint transaction (requires wallet signature)',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        transaction: { type: 'string', description: 'Base64 encoded transaction' },
                                        assetId: { type: 'string', description: 'New NFT asset ID' },
                                        message: { type: 'string' }
                                    }
                                }
                            }
                        }
                    },
                    '400': { description: 'Missing required fields' },
                    '402': { description: 'Payment required' }
                }
            }
        },
        '/transfer': {
            post: {
                tags: ['NFT'],
                summary: 'Transfer NFT',
                description: 'Transfer an NFT to another wallet. Returns transaction for signing.',
                operationId: 'transferNft',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['assetId', 'from', 'to'],
                                properties: {
                                    assetId: { type: 'string', description: 'NFT asset public key', example: '2XdTrzXQKhSFc6SN2FNtrVd7ZWdcmf6ri7jvku2wz3tZ' },
                                    from: { type: 'string', description: 'Current owner wallet (will sign)', example: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' },
                                    to: { type: 'string', description: 'Recipient wallet address', example: 'DAtG6yHw8JhrhjZbEvRX4GM6ZwizNLjEf3UB33M2uLxR' }
                                }
                            },
                            example: {
                                assetId: '2XdTrzXQKhSFc6SN2FNtrVd7ZWdcmf6ri7jvku2wz3tZ',
                                from: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm',
                                to: 'DAtG6yHw8JhrhjZbEvRX4GM6ZwizNLjEf3UB33M2uLxR'
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Transfer transaction (requires wallet signature)',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        transaction: { type: 'string' },
                                        message: { type: 'string' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },

        // ==================== MARKETPLACE ====================
        '/list': {
            post: {
                tags: ['Marketplace'],
                summary: 'List NFT for Sale',
                description: 'Create an escrow listing for an NFT. Requires wallet signature.',
                operationId: 'listNft',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['assetId', 'price', 'seller'],
                                properties: {
                                    assetId: { type: 'string', description: 'NFT asset public key', example: '2XdTrzXQKhSFc6SN2FNtrVd7ZWdcmf6ri7jvku2wz3tZ' },
                                    price: { type: 'number', description: 'Price in SOL', example: 1.5 },
                                    seller: { type: 'string', description: 'Seller wallet address', example: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' },
                                    buyer: { type: 'string', description: 'Optional specific buyer address' }
                                }
                            },
                            example: {
                                assetId: '2XdTrzXQKhSFc6SN2FNtrVd7ZWdcmf6ri7jvku2wz3tZ',
                                price: 1.5,
                                seller: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm'
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Escrow listing created',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        escrowPDA: { type: 'string' },
                                        transaction: { type: 'string' },
                                        message: { type: 'string' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/buy': {
            post: {
                tags: ['Marketplace'],
                summary: 'Buy Listed NFT',
                description: 'Purchase an NFT from escrow. Requires wallet signature and SOL payment.',
                operationId: 'buyNft',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['escrowPDA', 'buyer'],
                                properties: {
                                    escrowPDA: { type: 'string', description: 'Escrow PDA address', example: 'Y7WCkB2ga7LGGpYdgL6HkSDccSAw5sFdkgzVsdBBgD1' },
                                    buyer: { type: 'string', description: 'Buyer wallet address', example: 'DAtG6yHw8JhrhjZbEvRX4GM6ZwizNLjEf3UB33M2uLxR' },
                                    assetId: { type: 'string', description: 'NFT asset public key', example: 'F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F' },
                                    seller: { type: 'string', description: 'Seller wallet address', example: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' }
                                }
                            },
                            example: {
                                escrowPDA: 'Y7WCkB2ga7LGGpYdgL6HkSDccSAw5sFdkgzVsdBBgD1',
                                buyer: 'DAtG6yHw8JhrhjZbEvRX4GM6ZwizNLjEf3UB33M2uLxR',
                                assetId: 'F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F',
                                seller: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm'
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Purchase transaction',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        transaction: { type: 'string' },
                                        message: { type: 'string' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/cancel': {
            post: {
                tags: ['Marketplace'],
                summary: 'Cancel NFT Listing',
                description: 'Cancel an escrow listing and return NFT to seller',
                operationId: 'cancelListing',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['escrowPDA', 'seller'],
                                properties: {
                                    escrowPDA: { type: 'string', example: 'Y7WCkB2ga7LGGpYdgL6HkSDccSAw5sFdkgzVsdBBgD1' },
                                    seller: { type: 'string', example: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' },
                                    assetId: { type: 'string', example: 'F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F' }
                                }
                            },
                            example: {
                                escrowPDA: 'Y7WCkB2ga7LGGpYdgL6HkSDccSAw5sFdkgzVsdBBgD1',
                                seller: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm',
                                assetId: 'F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F'
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Listing cancelled' }
                }
            }
        },
        '/listings': {
            get: {
                tags: ['Marketplace'],
                summary: 'Get All Listings',
                description: 'Get all active NFT listings from escrow',
                operationId: 'getListings',
                parameters: [
                    { name: 'seller', in: 'query', schema: { type: 'string', default: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' }, description: 'Filter by seller wallet', example: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' },
                    { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'sold', 'cancelled'] } }
                ],
                responses: {
                    '200': {
                        description: 'List of NFT listings',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'array',
                                    items: { $ref: '#/components/schemas/Listing' }
                                }
                            }
                        }
                    }
                }
            }
        },

        // ==================== EVENTS ====================
        '/api/events': {
            get: {
                tags: ['Events'],
                summary: 'List All Events',
                operationId: 'listEvents',
                responses: {
                    '200': {
                        description: 'List of events',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'array',
                                    items: { $ref: '#/components/schemas/Event' }
                                }
                            }
                        }
                    }
                }
            },
            post: {
                tags: ['Events'],
                summary: 'Create Event',
                description: 'Create a new event with optional auto-mint rewards',
                operationId: 'createEvent',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['name', 'creatorWallet'],
                                properties: {
                                    name: { type: 'string', example: 'Summer Music Festival' },
                                    description: { type: 'string', example: 'Annual music event with NFT rewards' },
                                    entryFee: { type: 'number', description: 'Fee in SOL', example: 0.01 },
                                    eventDate: { type: 'string', format: 'date-time', example: '2026-06-15T14:00:00.000Z' },
                                    creatorWallet: { type: 'string', example: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' },
                                    enableRewards: { type: 'boolean', default: false, description: 'Enable auto-minted NFT rewards' },
                                    rewardConfig: {
                                        type: 'object',
                                        description: 'Custom reward configuration',
                                        properties: {
                                            goldSupply: { type: 'integer', default: 1 },
                                            goldPoints: { type: 'integer', default: 100 },
                                            goldName: { type: 'string', default: 'Gold Medal' },
                                            silverSupply: { type: 'integer', default: 3 },
                                            silverPoints: { type: 'integer', default: 60 },
                                            bronzeSupply: { type: 'integer', default: 5 },
                                            bronzePoints: { type: 'integer', default: 30 }
                                        }
                                    }
                                }
                            },
                            example: {
                                name: 'Summer Music Festival',
                                description: 'Annual music event with NFT rewards',
                                entryFee: 0.01,
                                eventDate: '2026-06-15T14:00:00.000Z',
                                creatorWallet: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm',
                                enableRewards: true
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Event created',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Event' }
                            }
                        }
                    }
                }
            }
        },
        '/api/events/{id}/join': {
            post: {
                tags: ['Events'],
                summary: 'Join Event',
                operationId: 'joinEvent',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string', default: '4eaf98ff-950c-4bdb-aced-9351cf358527' }, example: '4eaf98ff-950c-4bdb-aced-9351cf358527' }
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['walletAddress'],
                                properties: {
                                    walletAddress: { type: 'string', example: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' },
                                    userId: { type: 'string' },
                                    amount: { type: 'number', description: 'Entry fee paid', example: 0.01 },
                                    txHash: { type: 'string', description: 'Payment transaction hash' }
                                }
                            },
                            example: {
                                walletAddress: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm',
                                amount: 0.01
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Successfully joined event' },
                    '400': { description: 'Already joined or missing fields' }
                }
            }
        },
        '/api/events/{id}': {
            delete: {
                tags: ['Events', 'Admin'],
                summary: 'Delete Event',
                security: [{ ApiKeyAuth: [] }],
                operationId: 'deleteEvent',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string', default: '4eaf98ff-950c-4bdb-aced-9351cf358527' }, example: '4eaf98ff-950c-4bdb-aced-9351cf358527' }
                ],
                responses: {
                    '200': { description: 'Event deleted' },
                    '401': { description: 'Unauthorized' }
                }
            }
        },
        '/api/events/{id}/rewards/status': {
            get: {
                tags: ['Event Rewards'],
                summary: 'Get Event Reward Minting Status',
                operationId: 'getEventRewardStatus',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': {
                        description: 'Reward minting status',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        status: { type: 'string', enum: ['PENDING', 'MINTING', 'COMPLETED', 'FAILED'] },
                                        totalToMint: { type: 'integer' },
                                        mintedCount: { type: 'integer' },
                                        rewards: { type: 'array', items: { $ref: '#/components/schemas/EventRewardNft' } }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/events/{id}/rewards/retry': {
            post: {
                tags: ['Event Rewards', 'Admin'],
                summary: 'Retry Event Reward Minting',
                security: [{ ApiKeyAuth: [] }],
                operationId: 'retryEventRewardMinting',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Minting retried' }
                }
            }
        },

        // ==================== EVENT REWARDS ====================
        '/api/events/{id}/progress': {
            get: {
                tags: ['Event Rewards'],
                summary: 'Get User Event Progress',
                description: 'Get user\'s points, available rewards, and claims for an event',
                operationId: 'getEventProgress',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Event ID' },
                    { name: 'walletAddress', in: 'query', required: true, schema: { type: 'string' }, description: 'User wallet address' }
                ],
                responses: {
                    '200': {
                        description: 'User progress and rewards',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/EventProgress' }
                            }
                        }
                    }
                }
            }
        },
        '/api/events/{id}/progress/add-points': {
            post: {
                tags: ['Event Rewards'],
                summary: 'Add Points to User',
                description: 'Add points to user\'s event progress (for completing tasks)',
                operationId: 'addEventPoints',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['walletAddress', 'points'],
                                properties: {
                                    walletAddress: { type: 'string' },
                                    points: { type: 'integer', example: 10 },
                                    reason: { type: 'string', example: 'Completed quiz' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Points added',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        progress: {
                                            type: 'object',
                                            properties: {
                                                totalPoints: { type: 'integer' },
                                                tasksCompleted: { type: 'integer' }
                                            }
                                        },
                                        pointsAdded: { type: 'integer' },
                                        reason: { type: 'string' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/events/{id}/rewards/{rewardId}/claim': {
            post: {
                tags: ['Event Rewards'],
                summary: 'Claim Event Reward NFT',
                description: 'Claim an NFT reward. First call returns fee info, second call with feeTxHash processes the claim.',
                operationId: 'claimEventReward',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Event ID' },
                    { name: 'rewardId', in: 'path', required: true, schema: { type: 'string' }, description: 'Reward NFT ID' }
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['walletAddress'],
                                properties: {
                                    walletAddress: { type: 'string', description: 'User wallet to receive NFT' },
                                    feeTxHash: { type: 'string', description: 'Transaction hash of fee payment (0.002 SOL)' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Claim result or fee requirement',
                        content: {
                            'application/json': {
                                schema: {
                                    oneOf: [
                                        {
                                            type: 'object',
                                            description: 'Fee required',
                                            properties: {
                                                requiresFee: { type: 'boolean', example: true },
                                                claimFee: { type: 'number', example: 0.002 },
                                                adminWallet: { type: 'string' },
                                                message: { type: 'string' }
                                            }
                                        },
                                        {
                                            type: 'object',
                                            description: 'Claim successful',
                                            properties: {
                                                success: { type: 'boolean', example: true },
                                                claim: { $ref: '#/components/schemas/RewardClaim' }
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    },
                    '400': { description: 'Insufficient points or already claimed' }
                }
            }
        },

        // ==================== PAYMENTS ====================
        '/api/payment/create': {
            post: {
                tags: ['Payments'],
                summary: 'Create Payment Charge',
                description: 'Create a Coinbase Commerce charge for payment',
                operationId: 'createCharge',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['amount'],
                                properties: {
                                    amount: { type: 'number', example: 10.00 },
                                    currency: { type: 'string', default: 'USD', enum: ['USD', 'USDC'] },
                                    walletAddress: { type: 'string', description: 'Payer wallet for tracking' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Charge created',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        chargeId: { type: 'string' },
                                        address: { type: 'string' },
                                        amount: { type: 'number' },
                                        currency: { type: 'string' },
                                        hostedUrl: { type: 'string', description: 'Coinbase checkout URL' },
                                        isDemoMode: { type: 'boolean' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/payment/status/{id}': {
            get: {
                tags: ['Payments'],
                summary: 'Get Payment Status',
                operationId: 'getPaymentStatus',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': {
                        description: 'Payment status',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        status: { type: 'string', enum: ['PENDING', 'COMPLETED', 'CONFIRMED', 'FAILED', 'EXPIRED'] },
                                        amount: { type: 'number' },
                                        currency: { type: 'string' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/payment/check-status/{chargeId}': {
            post: {
                tags: ['Payments'],
                summary: 'Check and Update Payment Status',
                operationId: 'checkPaymentStatus',
                parameters: [
                    { name: 'chargeId', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Updated payment status' }
                }
            }
        },
        '/api/payment/cancel/{chargeId}': {
            post: {
                tags: ['Payments'],
                summary: 'Cancel Payment',
                operationId: 'cancelPayment',
                parameters: [
                    { name: 'chargeId', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Payment cancelled' }
                }
            }
        },
        '/api/payments/webhook': {
            post: {
                tags: ['Payments'],
                summary: 'Payment Webhook',
                description: 'Receive payment notifications (Solana or Coinbase)',
                operationId: 'paymentWebhook',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    solanaSignature: { type: 'string' },
                                    walletAddress: { type: 'string' },
                                    amount: { type: 'number' },
                                    chargeId: { type: 'string' },
                                    transactionType: { type: 'string', default: 'PAYMENT' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Webhook processed' }
                }
            }
        },
        '/api/payments/logs': {
            get: {
                tags: ['Payments'],
                summary: 'Get Payment Logs',
                operationId: 'getPaymentLogs',
                parameters: [
                    { name: 'chargeId', in: 'query', schema: { type: 'string' } },
                    { name: 'walletAddress', in: 'query', schema: { type: 'string' } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }
                ],
                responses: {
                    '200': { description: 'Payment logs' }
                }
            }
        },
        '/api/payments/transactions': {
            get: {
                tags: ['Payments'],
                summary: 'Get Transaction History',
                operationId: 'getTransactionHistory',
                parameters: [
                    { name: 'walletAddress', in: 'query', schema: { type: 'string' } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }
                ],
                responses: {
                    '200': { description: 'Transaction history' }
                }
            }
        },

        // ==================== DISPUTES ====================
        '/api/disputes': {
            get: {
                tags: ['Disputes'],
                summary: 'Get All Disputes',
                operationId: 'getDisputes',
                parameters: [
                    { name: 'status', in: 'query', schema: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'REFUNDED'] } },
                    { name: 'walletAddress', in: 'query', schema: { type: 'string', default: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' } }
                ],
                responses: {
                    '200': {
                        description: 'List of disputes',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        disputes: {
                                            type: 'array',
                                            items: { $ref: '#/components/schemas/Dispute' }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            post: {
                tags: ['Disputes'],
                summary: 'Create Dispute',
                operationId: 'createDispute',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['walletAddress', 'amount', 'reason'],
                                properties: {
                                    walletAddress: { type: 'string', example: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' },
                                    eventId: { type: 'string', example: '4eaf98ff-950c-4bdb-aced-9351cf358527' },
                                    eventEntryId: { type: 'string' },
                                    amount: { type: 'number', example: 0.5 },
                                    reason: { type: 'string', example: 'Event was cancelled without notice' },
                                    transactionId: { type: 'string' }
                                }
                            },
                            example: {
                                walletAddress: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm',
                                amount: 0.5,
                                reason: 'Event was cancelled without notice'
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Dispute created' }
                }
            }
        },
        '/api/disputes/{id}': {
            get: {
                tags: ['Disputes'],
                summary: 'Get Dispute Details',
                operationId: 'getDispute',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string', default: '38d9ad88-7e45-4bc2-9754-2b5f4ac85248' }, example: '38d9ad88-7e45-4bc2-9754-2b5f4ac85248' }
                ],
                responses: {
                    '200': { description: 'Dispute details' }
                }
            }
        },
        '/api/disputes/{id}/resolve': {
            post: {
                tags: ['Disputes'],
                summary: 'Resolve Dispute',
                operationId: 'resolveDispute',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string', default: '38d9ad88-7e45-4bc2-9754-2b5f4ac85248' }, example: '38d9ad88-7e45-4bc2-9754-2b5f4ac85248' }
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['resolution'],
                                properties: {
                                    resolution: { type: 'string', enum: ['APPROVED', 'REJECTED'], example: 'APPROVED' },
                                    notes: { type: 'string', example: 'Verified - issuing refund' }
                                }
                            },
                            example: {
                                resolution: 'APPROVED',
                                notes: 'Verified - issuing refund'
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Dispute resolved' }
                }
            }
        },
        '/api/disputes/{id}/refunded': {
            post: {
                tags: ['Disputes'],
                summary: 'Mark Dispute as Refunded',
                operationId: 'markDisputeRefunded',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Marked as refunded' }
                }
            }
        },

        // ==================== REWARDS ====================
        '/api/rewards/account': {
            get: {
                tags: ['Rewards'],
                summary: 'Get or Create Reward Account',
                operationId: 'getRewardAccount',
                parameters: [
                    { name: 'walletAddress', in: 'query', required: true, schema: { type: 'string', default: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' }, example: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' }
                ],
                responses: {
                    '200': {
                        description: 'Reward account',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/RewardAccount' }
                            }
                        }
                    }
                }
            }
        },
        '/api/rewards/interaction': {
            post: {
                tags: ['Rewards'],
                summary: 'Record Interaction',
                description: 'Record user interaction to earn points',
                operationId: 'recordInteraction',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['walletAddress'],
                                properties: {
                                    walletAddress: { type: 'string', example: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' },
                                    interactionType: { type: 'string', default: 'CLICK', enum: ['CLICK', 'VIEW', 'PURCHASE', 'SHARE'] },
                                    points: { type: 'integer', default: 10 }
                                }
                            },
                            example: {
                                walletAddress: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm',
                                interactionType: 'CLICK',
                                points: 10
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Interaction recorded' }
                }
            }
        },
        '/api/rewards/claim': {
            post: {
                tags: ['Rewards'],
                summary: 'Claim NFT Reward',
                operationId: 'claimReward',
                description: 'Transfers a vault NFT to the user. The server signs and submits the '
                    + 'transfer, so the response is synchronous and the client signs nothing. '
                    + 'Points are debited only after the transfer lands.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['walletAddress', 'rewardNftId'],
                                properties: {
                                    walletAddress: { type: 'string', example: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' },
                                    rewardNftId: { type: 'string', description: 'RewardNft.id from GET /api/rewards/available (a UUID, not the on-chain asset address)', example: '9f1c2b64-6f0a-4d3e-9c11-0b2d5a7e4c88' }
                                }
                            },
                            example: {
                                walletAddress: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm',
                                rewardNftId: '9f1c2b64-6f0a-4d3e-9c11-0b2d5a7e4c88'
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Reward claimed and NFT transferred',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        txHash: { type: 'string', description: 'Signature of the completed transfer' },
                                        claimedReward: {
                                            type: 'object',
                                            properties: {
                                                id: { type: 'string' },
                                                nftAsset: { type: 'string' },
                                                pointsUsed: { type: 'integer' },
                                                rewardType: { type: 'string' },
                                                createdAt: { type: 'string', format: 'date-time' }
                                            }
                                        },
                                        rewardAccount: {
                                            type: 'object',
                                            properties: {
                                                interactionCount: { type: 'integer' },
                                                claimedNfts: { type: 'integer' }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    '400': { description: 'Insufficient points, out of supply, or reward inactive' },
                    '404': { description: 'User or reward account not found' }
                }
            }
        },
        '/api/rewards/available': {
            get: {
                tags: ['Rewards'],
                summary: 'Get Available Rewards',
                operationId: 'getAvailableRewards',
                description: 'Returns minted reward NFTs and listed drafts in one array, sorted by '
                    + 'requiredPoints. Draft entries carry isDraft:true and an empty nftAsset - they '
                    + 'are not minted yet and cannot be claimed.',
                responses: {
                    '200': {
                        description: 'List of available rewards',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        rewards: { type: 'array', items: { $ref: '#/components/schemas/AvailableReward' } }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },

        // ==================== ALBUMS ====================
        '/api/albums': {
            get: {
                tags: ['Albums'],
                summary: 'List Albums',
                operationId: 'listAlbums',
                parameters: [
                    { name: 'published', in: 'query', schema: { type: 'boolean', default: true } },
                    { name: 'creator', in: 'query', schema: { type: 'string', default: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' }, example: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' }
                ],
                responses: {
                    '200': {
                        description: 'List of albums',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        albums: {
                                            type: 'array',
                                            items: { $ref: '#/components/schemas/Album' }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            post: {
                tags: ['Albums'],
                summary: 'Create Album',
                operationId: 'createAlbum',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['name', 'artist', 'coverUrl', 'creatorWallet'],
                                properties: {
                                    name: { type: 'string', example: 'My Album' },
                                    artist: { type: 'string', example: 'Artist Name' },
                                    description: { type: 'string', example: 'Album description' },
                                    coverUrl: { type: 'string', example: 'https://kumele-backend.ansht.workers.dev/cdn/images/example.jpg' },
                                    releaseDate: { type: 'string', format: 'date', example: '2026-01-29' },
                                    genre: { type: 'string', example: 'Electronic' },
                                    price: { type: 'number', example: 0.1 },
                                    creatorWallet: { type: 'string', example: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm' }
                                }
                            },
                            example: {
                                name: 'My Album',
                                artist: 'Artist Name',
                                description: 'Album description',
                                coverUrl: 'https://kumele-backend.ansht.workers.dev/cdn/images/example.jpg',
                                genre: 'Electronic',
                                price: 0.1,
                                creatorWallet: 'anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm'
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Album created' }
                }
            }
        },
        '/api/albums/{id}': {
            get: {
                tags: ['Albums'],
                summary: 'Get Album',
                operationId: 'getAlbum',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Album details with tracks' }
                }
            },
            put: {
                tags: ['Albums'],
                summary: 'Update Album',
                operationId: 'updateAlbum',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    description: { type: 'string' },
                                    isPublished: { type: 'boolean' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Album updated' }
                }
            },
            delete: {
                tags: ['Albums'],
                summary: 'Delete Album',
                operationId: 'deleteAlbum',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Album deleted' }
                }
            }
        },
        '/api/albums/{id}/tracks': {
            post: {
                tags: ['Albums'],
                summary: 'Add Track to Album',
                operationId: 'addTrack',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['name', 'audioUrl'],
                                properties: {
                                    name: { type: 'string' },
                                    audioUrl: { type: 'string' },
                                    duration: { type: 'integer', description: 'Duration in seconds' },
                                    trackNumber: { type: 'integer' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Track added' }
                }
            }
        },
        '/api/albums/{id}/tracks/{trackId}': {
            put: {
                tags: ['Albums'],
                summary: 'Update Track',
                operationId: 'updateTrack',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    { name: 'trackId', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Track updated' }
                }
            },
            delete: {
                tags: ['Albums'],
                summary: 'Delete Track',
                operationId: 'deleteTrack',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    { name: 'trackId', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Track deleted' }
                }
            }
        },
        '/api/albums/{id}/tracks/{trackId}/metadata': {
            get: {
                tags: ['Albums'],
                summary: 'Generate Track NFT Metadata',
                operationId: 'generateTrackMetadata',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    { name: 'trackId', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'NFT metadata JSON' }
                }
            }
        },

        // ==================== UPLOAD ====================
        '/api/upload/image': {
            post: {
                tags: ['Upload'],
                summary: 'Upload Image',
                description: 'Upload image/video/audio to R2 storage',
                operationId: 'uploadImage',
                requestBody: {
                    required: true,
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: 'object',
                                properties: {
                                    image: { type: 'string', format: 'binary' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Image uploaded',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        url: { type: 'string' },
                                        filename: { type: 'string' },
                                        size: { type: 'integer' },
                                        contentType: { type: 'string' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/upload/files': {
            post: {
                tags: ['Upload'],
                summary: 'Upload Multiple Files',
                description: 'Upload main file + optional cover file',
                operationId: 'uploadFiles',
                requestBody: {
                    required: true,
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: 'object',
                                properties: {
                                    mainFile: { type: 'string', format: 'binary' },
                                    coverFile: { type: 'string', format: 'binary' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Files uploaded' }
                }
            }
        },
        '/api/upload/metadata': {
            post: {
                tags: ['Upload'],
                summary: 'Upload Metadata JSON',
                description: 'Upload NFT metadata JSON to R2',
                operationId: 'uploadMetadata',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    metadata: {
                                        type: 'object',
                                        description: 'NFT metadata object',
                                        properties: {
                                            name: { type: 'string' },
                                            description: { type: 'string' },
                                            image: { type: 'string' },
                                            animation_url: { type: 'string' },
                                            attributes: { type: 'array' }
                                        }
                                    },
                                    filename: { type: 'string', description: 'Optional custom filename' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Metadata uploaded',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        url: { type: 'string' }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/api/upload/audio': {
            post: {
                tags: ['Upload'],
                summary: 'Upload Audio',
                description: 'Upload audio file with streaming support',
                operationId: 'uploadAudio',
                requestBody: {
                    required: true,
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: 'object',
                                properties: {
                                    audio: { type: 'string', format: 'binary' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Audio uploaded' }
                }
            }
        },
        '/cdn/images/{filename}': {
            get: {
                tags: ['Upload'],
                summary: 'Serve Image from R2',
                operationId: 'serveImage',
                parameters: [
                    { name: 'filename', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Image file' }
                }
            }
        },
        '/cdn/metadata/{filename}': {
            get: {
                tags: ['Upload'],
                summary: 'Serve Metadata from R2',
                operationId: 'serveMetadata',
                parameters: [
                    { name: 'filename', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Metadata JSON' }
                }
            }
        },
        '/cdn/audio/{filename}': {
            get: {
                tags: ['Upload'],
                summary: 'Stream Audio from R2',
                description: 'Audio streaming with range request support',
                operationId: 'serveAudio',
                parameters: [
                    { name: 'filename', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Audio stream' },
                    '206': { description: 'Partial content (range request)' }
                }
            }
        },

        // ==================== ADMIN ====================
        '/api/admin/dashboard': {
            get: {
                tags: ['Admin'],
                summary: 'Get Admin Dashboard',
                security: [{ ApiKeyAuth: [] }],
                operationId: 'getAdminDashboard',
                responses: {
                    '200': { description: 'Dashboard statistics' },
                    '401': { description: 'Unauthorized' }
                }
            }
        },
        '/api/escrow/admin_resolve': {
            post: {
                tags: ['Admin', 'Marketplace'],
                summary: 'Admin Resolve Escrow',
                security: [{ ApiKeyAuth: [] }],
                operationId: 'adminResolveEscrow',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['escrowPDA', 'resolution'],
                                properties: {
                                    escrowPDA: { type: 'string' },
                                    resolution: { type: 'string', enum: ['refund', 'complete'] }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Escrow resolved' }
                }
            }
        },
        '/api/admin/rewards/mint': {
            post: {
                tags: ['Admin'],
                summary: 'Mint Reward NFT',
                security: [{ ApiKeyAuth: [] }],
                operationId: 'mintRewardNft',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['name', 'metadataUri', 'requiredPoints', 'adminWallet'],
                                properties: {
                                    name: { type: 'string' },
                                    description: { type: 'string' },
                                    metadataUri: { type: 'string' },
                                    imageUrl: { type: 'string' },
                                    requiredPoints: { type: 'integer' },
                                    rewardType: { type: 'string', default: 'MUSIC_NFT' },
                                    adminWallet: { type: 'string' },
                                    totalSupply: { type: 'integer', default: 1 }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'NFT minted (transaction requires signing)' }
                }
            }
        },
        '/api/admin/rewards': {
            get: {
                tags: ['Admin'],
                summary: 'Get All Reward NFTs',
                security: [{ ApiKeyAuth: [] }],
                operationId: 'getAllRewardNfts',
                responses: {
                    '200': { description: 'List of reward NFTs' }
                }
            }
        },
        '/api/admin/rewards/{id}': {
            put: {
                tags: ['Admin'],
                summary: 'Update Reward NFT',
                security: [{ ApiKeyAuth: [] }],
                operationId: 'updateRewardNft',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Reward updated' }
                }
            },
            delete: {
                tags: ['Admin'],
                summary: 'Delete Reward NFT',
                security: [{ ApiKeyAuth: [] }],
                operationId: 'deleteRewardNft',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Reward deleted' }
                }
            }
        },
        '/api/admin/rewards/fill-meter': {
            post: {
                tags: ['Admin'],
                summary: 'Fill Reward Meter',
                security: [{ ApiKeyAuth: [] }],
                operationId: 'fillMeter',
                responses: {
                    '200': { description: 'Meter filled' }
                }
            }
        },
        '/api/admin/rewards/reset-meter': {
            post: {
                tags: ['Admin'],
                summary: 'Reset Reward Meter',
                security: [{ ApiKeyAuth: [] }],
                operationId: 'resetMeter',
                responses: {
                    '200': { description: 'Meter reset' }
                }
            }
        },
        '/api/admin/rewards/drafts': {
            get: {
                tags: ['Admin'],
                summary: 'Get All Reward Drafts',
                security: [{ ApiKeyAuth: [] }],
                operationId: 'getAllRewardDrafts',
                responses: {
                    '200': { description: 'List of drafts' }
                }
            },
            post: {
                tags: ['Admin'],
                summary: 'Create Reward Draft',
                security: [{ ApiKeyAuth: [] }],
                operationId: 'createRewardDraft',
                responses: {
                    '200': { description: 'Draft created' }
                }
            }
        },
        '/api/admin/rewards/drafts/{id}': {
            put: {
                tags: ['Admin'],
                summary: 'Update Reward Draft',
                security: [{ ApiKeyAuth: [] }],
                operationId: 'updateRewardDraft',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Draft updated' }
                }
            },
            delete: {
                tags: ['Admin'],
                summary: 'Delete Reward Draft',
                security: [{ ApiKeyAuth: [] }],
                operationId: 'deleteRewardDraft',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Draft deleted' }
                }
            }
        },
        '/api/admin/events/{id}/reward-config': {
            put: {
                tags: ['Admin', 'Event Rewards'],
                summary: 'Update Event Reward Config',
                security: [{ ApiKeyAuth: [] }],
                operationId: 'updateEventRewardConfig',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    goldSupply: { type: 'integer' },
                                    goldPoints: { type: 'integer' },
                                    goldName: { type: 'string' },
                                    silverSupply: { type: 'integer' },
                                    silverPoints: { type: 'integer' },
                                    bronzeSupply: { type: 'integer' },
                                    bronzePoints: { type: 'integer' }
                                }
                            }
                        }
                    }
                },
                responses: {
                    '200': { description: 'Config updated' }
                }
            }
        },
        '/api/admin/events/{id}/claims': {
            get: {
                tags: ['Admin', 'Event Rewards'],
                summary: 'Get Event Reward Claims',
                security: [{ ApiKeyAuth: [] }],
                operationId: 'getEventRewardClaims',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'List of claims' }
                }
            }
        },
        '/api/admin/claims': {
            get: {
                tags: ['Admin', 'Event Rewards'],
                summary: 'Get All Claims',
                security: [{ ApiKeyAuth: [] }],
                operationId: 'getAllClaims',
                responses: {
                    '200': { description: 'List of all claims' }
                }
            }
        },
        '/api/audit/verify/{transactionId}': {
            get: {
                tags: ['Admin'],
                summary: 'Verify Transaction Checksum',
                operationId: 'verifyTransactionChecksum',
                parameters: [
                    { name: 'transactionId', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: {
                    '200': { description: 'Transaction is valid' },
                    '400': { description: 'Transaction checksum mismatch' }
                }
            }
        }
    },
    components: {
        securitySchemes: {
            ApiKeyAuth: {
                type: 'apiKey',
                in: 'header',
                name: 'X-Admin-API-Key',
                description: 'Admin API key for protected endpoints'
            }
        },
        schemas: {
            NftAsset: {
                type: 'object',
                properties: {
                    publicKey: { type: 'string' },
                    owner: { type: 'string' },
                    uri: { type: 'string' },
                    name: { type: 'string' },
                    updateAuthority: {
                        type: 'object',
                        properties: {
                            type: { type: 'string' },
                            address: { type: 'string' }
                        }
                    }
                }
            },
            Listing: {
                type: 'object',
                properties: {
                    escrowPDA: { type: 'string' },
                    assetId: { type: 'string' },
                    seller: { type: 'string' },
                    buyer: { type: 'string', nullable: true },
                    price: { type: 'number' },
                    status: { type: 'string', enum: ['Pending', 'Deposited', 'Completed', 'Cancelled', 'Disputed'] }
                }
            },
            Event: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                    entryFee: { type: 'number' },
                    eventDate: { type: 'string', format: 'date-time' },
                    creatorWallet: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                    entries: { type: 'array', items: { type: 'object' } }
                }
            },
            EventProgress: {
                type: 'object',
                properties: {
                    progress: {
                        type: 'object',
                        nullable: true,
                        properties: {
                            id: { type: 'string' },
                            totalPoints: { type: 'integer' },
                            tasksCompleted: { type: 'integer' },
                            createdAt: { type: 'string' },
                            updatedAt: { type: 'string' }
                        }
                    },
                    rewards: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/EventRewardNft' }
                    },
                    claims: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/RewardClaim' }
                    },
                    hasJoined: { type: 'boolean' },
                    claimFee: { type: 'number' }
                }
            },
            // Shape returned by GET /api/rewards/available. Distinct from EventRewardNft: that one
            // is the per-event medal, this is the global loyalty reward (and listed drafts).
            AvailableReward: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Pass this as rewardNftId to POST /api/rewards/claim' },
                    name: { type: 'string' },
                    description: { type: 'string', nullable: true },
                    requiredPoints: { type: 'integer' },
                    rewardType: { type: 'string', example: 'MUSIC_NFT' },
                    nftAsset: { type: 'string', description: 'On-chain asset address; empty string for drafts' },
                    imageUrl: { type: 'string', nullable: true },
                    metadataUri: { type: 'string' },
                    totalSupply: { type: 'integer' },
                    claimedCount: { type: 'integer' },
                    isActive: { type: 'boolean' },
                    isDraft: { type: 'boolean', description: 'Present and true only on unminted drafts; these are not claimable' }
                }
            },
            EventRewardNft: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    medalType: { type: 'string', enum: ['GOLD', 'SILVER', 'BRONZE'] },
                    name: { type: 'string' },
                    description: { type: 'string' },
                    imageUrl: { type: 'string' },
                    requiredPoints: { type: 'integer' },
                    totalSupply: { type: 'integer' },
                    claimedCount: { type: 'integer' },
                    available: { type: 'integer' },
                    nftAsset: { type: 'string', nullable: true }
                }
            },
            RewardClaim: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    medalType: { type: 'string' },
                    nftAsset: { type: 'string' },
                    pointsUsed: { type: 'integer' },
                    txHash: { type: 'string' },
                    claimedAt: { type: 'string', format: 'date-time' }
                }
            },
            RewardAccount: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    walletAddress: { type: 'string' },
                    totalPoints: { type: 'integer' },
                    meterLevel: { type: 'integer' },
                    claimedRewards: { type: 'array', items: { type: 'object' } }
                }
            },
            Dispute: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    walletAddress: { type: 'string' },
                    amount: { type: 'number' },
                    reason: { type: 'string' },
                    status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'REFUNDED'] },
                    createdAt: { type: 'string', format: 'date-time' }
                }
            },
            Album: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    artist: { type: 'string' },
                    description: { type: 'string' },
                    coverUrl: { type: 'string' },
                    genre: { type: 'string' },
                    price: { type: 'number' },
                    creatorWallet: { type: 'string' },
                    isPublished: { type: 'boolean' },
                    totalTracks: { type: 'integer' },
                    tracks: { type: 'array', items: { $ref: '#/components/schemas/Track' } }
                }
            },
            Track: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    audioUrl: { type: 'string' },
                    duration: { type: 'integer' },
                    trackNumber: { type: 'integer' }
                }
            },
            Error: {
                type: 'object',
                properties: {
                    error: { type: 'string' }
                }
            }
        }
    }
}
