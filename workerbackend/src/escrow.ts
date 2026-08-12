import { Context } from 'hono'
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'
import { BN, Program, AnchorProvider } from '@coral-xyz/anchor'
import { createNoopSigner, publicKey as umiPublicKey, signerIdentity } from '@metaplex-foundation/umi'
import { getUmi } from './umi'
import { fetchAssetV1, getAssetV1GpaBuilder } from '@metaplex-foundation/mpl-core'
import { withPrisma, getConnectionString, ensureUserExists } from './db'
import { logBlockchainTransaction, logAudit } from './audit'

// Lazy initialization to avoid module-level PublicKey creation issues
// Using the deployed escrow program ID (this is the actual deployed program on devnet)
const getEscrowProgramId = () => new PublicKey('3ozh4TQJbeyXFUuXsj7fYmHB5aCVkg24cZN5zZmigR44')

// Buffer is set globally in index.ts
const ESCROW_SEED = Buffer.from('escrow')

function getEscrowPDA(asset: PublicKey, seller: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [ESCROW_SEED, asset.toBuffer(), seller.toBuffer()],
        getEscrowProgramId()
    )
}


interface EscrowAccount {
    asset: PublicKey
    seller: PublicKey
    buyer: PublicKey | null
    price: bigint
    bump: number
    status: number // 0=Pending, 1=Deposited, 2=Completed, 3=Cancelled, 4=Disputed
}

function parseEscrowAccount(data: Buffer): EscrowAccount {

    let offset = 8

    const asset = new PublicKey(data.slice(offset, offset + 32))
    offset += 32

    const seller = new PublicKey(data.slice(offset, offset + 32))
    offset += 32


    const hasBuyer = data[offset] === 1
    offset += 1

    let buyer: PublicKey | null = null
    if (hasBuyer) {
        buyer = new PublicKey(data.slice(offset, offset + 32))
        offset += 32
    }

    const price = data.readBigUInt64LE(offset)
    offset += 8

    const bump = data[offset]
    offset += 1

    const status = data[offset]

    return { asset, seller, buyer, price, bump, status }
}

const getIDL = () => ({
    address: getEscrowProgramId().toBase58(),
    metadata: {
        name: 'nftmarketplace',
        version: '0.1.0',
        spec: '0.1.0',
    },
    instructions: [
        {
            name: 'create_escrow',
            discriminator: [253, 215, 165, 116, 36, 108, 68, 80],
            accounts: [
                { name: 'seller', writable: true, signer: true },
                { name: 'asset' },
                { name: 'escrow', writable: true, pda: { seeds: [{ kind: 'const', value: [101, 115, 99, 114, 111, 119] }, { kind: 'account', path: 'asset' }, { kind: 'account', path: 'seller' }] } },
                { name: 'system_program', address: '11111111111111111111111111111111' },
            ],
            args: [
                { name: 'price', type: 'u64' },
                { name: 'buyer', type: { option: 'pubkey' } },
            ],
        },
        {
            name: 'deposit_asset',
            discriminator: [107, 93, 89, 87, 226, 203, 154, 19],
            accounts: [
                { name: 'seller', writable: true, signer: true },
                { name: 'asset', writable: true },
                { name: 'escrow', writable: true },
                { name: 'system_program', address: '11111111111111111111111111111111' },
                { name: 'mpl_core_program', address: 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d' },
            ],
            args: [],
        },
        {
            name: 'buy_asset',
            discriminator: [197, 37, 177, 1, 180, 23, 175, 98],
            accounts: [
                { name: 'buyer', writable: true, signer: true },
                { name: 'asset', writable: true },
                { name: 'seller', writable: true },
                { name: 'escrow', writable: true },
                { name: 'system_program', address: '11111111111111111111111111111111' },
                { name: 'mpl_core_program', address: 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d' },
            ],
            args: [],
        },
        {
            name: 'cancel_escrow',
            discriminator: [156, 203, 54, 179, 38, 72, 33, 21],
            accounts: [
                { name: 'seller', writable: true, signer: true },
                { name: 'asset', writable: true },
                { name: 'escrow', writable: true },
                { name: 'system_program', address: '11111111111111111111111111111111' },
                { name: 'mpl_core_program', address: 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d' },
            ],
            args: [],
        },
        {
            name: 'close_escrow',
            discriminator: [139, 171, 94, 146, 191, 91, 144, 50],
            accounts: [
                { name: 'seller', writable: true, signer: true },
                { name: 'escrow', writable: true, pda: { seeds: [{ kind: 'const', value: [101, 115, 99, 114, 111, 119] }, { kind: 'account', path: 'asset' }, { kind: 'account', path: 'seller' }] } },
            ],
            args: [],
        },
        {
            name: 'admin_resolve',
            discriminator: [90, 215, 29, 95, 17, 61, 118, 229],
            accounts: [
                { name: 'admin', writable: true, signer: true },
                { name: 'seller', writable: true },
                { name: 'buyer', writable: true },
                { name: 'asset', writable: true },
                { name: 'escrow', writable: true },
                { name: 'system_program', address: '11111111111111111111111111111111' },
                { name: 'mpl_core_program', address: 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d' },
            ],
            args: [
                { name: 'refund_buyer', type: 'bool' },
            ],
        },
    ],
})

export const getListings = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        // Use public devnet RPC as fallback if API key is invalid
        let rpcUrl = c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
        const connection = new Connection(rpcUrl)


        let accounts: any[] = []
        try {
            console.log('Fetching program accounts for:', getEscrowProgramId().toBase58())
            accounts = await connection.getProgramAccounts(getEscrowProgramId()) as any[]
            console.log(`Found ${accounts.length} program accounts`)
        } catch (e: any) {
            console.error('Error fetching program accounts:', e.message)
            
            // If API key is invalid, try public RPC as fallback
            if (e.message?.includes('401') || e.message?.includes('Invalid API key') || e.message?.includes('Unauthorized')) {
                console.log('API key invalid, trying public devnet RPC for listings...')
                try {
                    const publicRpcUrl = 'https://api.devnet.solana.com'
                    const publicConnection = new Connection(publicRpcUrl)
                    accounts = await publicConnection.getProgramAccounts(getEscrowProgramId()) as any[]
                    console.log(`Found ${accounts.length} program accounts using public RPC`)
                } catch (fallbackError: any) {
                    console.error('Fallback RPC also failed:', fallbackError.message)
                    return c.json({ listings: [] })
                }
            } else {
                console.log('Program not deployed or no accounts found, returning empty list')
                return c.json({ listings: [] })
            }
        }

        // Use the same RPC URL for UMI (with fallback)
        let umiRpcUrl = rpcUrl
        const umi = getUmi(umiRpcUrl)
        const listings = []

        for (const { pubkey, account } of accounts) {
            try {
                const escrowData = parseEscrowAccount(account.data)

                if (escrowData.status !== 1) {
                    continue
                }

                let asset
                try {
                    asset = await fetchAssetV1(umi, umiPublicKey(escrowData.asset.toBase58()))
                } catch (assetError: any) {
                    // If asset fetch fails with 401, try public RPC
                    if (assetError.message?.includes('401') || assetError.message?.includes('Invalid API key') || assetError.message?.includes('Unauthorized') || assetError.message?.includes('failed to get info')) {
                        console.log('Asset fetch failed, trying public RPC...')
                        umiRpcUrl = 'https://api.devnet.solana.com'
                        const publicUmi = getUmi(umiRpcUrl)
                        asset = await fetchAssetV1(publicUmi, umiPublicKey(escrowData.asset.toBase58()))
                    } else {
                        throw assetError
                    }
                }

                listings.push({
                    escrow: pubkey.toBase58(),
                    asset: escrowData.asset.toBase58(),
                    seller: escrowData.seller.toBase58(),
                    price: Number(escrowData.price) / 1e9,
                    name: asset.name,
                    uri: asset.uri,
                })
            } catch (error) {
                console.error('Error processing escrow:', pubkey.toBase58(), error)
            }
        }

        return c.json({ listings })
    } catch (error) {
        console.error('Get listings error details:', error);
        if (error instanceof Error) {
            console.error('Stack:', error.stack);
        }
        return c.text(`Get listings failed: ${error}`, 500)
    }
}

export const listNft = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const body = await c.req.json()
        const { assetId, seller, price } = body

        if (!assetId || !seller || !price) {
            return c.text('Missing assetId, seller, or price', 400)
        }

        const assetPubkey = new PublicKey(assetId)
        const sellerPubkey = new PublicKey(seller)
        const priceNum = Number(price)

        if (isNaN(priceNum) || priceNum <= 0) {
            return c.text('Invalid price', 400)
        }

        const [escrowPDA] = getEscrowPDA(assetPubkey, sellerPubkey)
        
        // Use public devnet RPC as fallback if API key is invalid
        let rpcUrl = c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
        let connection = new Connection(rpcUrl)

        const tx = new Transaction()

        let escrowAccountInfo
        try {
            escrowAccountInfo = await connection.getAccountInfo(escrowPDA)
        } catch (rpcError: any) {
            // If API key is invalid, try public RPC as fallback
            if (rpcError.message?.includes('401') || rpcError.message?.includes('Invalid API key') || rpcError.message?.includes('Unauthorized')) {
                console.log('API key invalid in listNft, trying public devnet RPC...')
                rpcUrl = 'https://api.devnet.solana.com'
                connection = new Connection(rpcUrl)
                escrowAccountInfo = await connection.getAccountInfo(escrowPDA)
            } else {
                throw rpcError
            }
        }

        if (escrowAccountInfo) {
            console.log('Escrow account exists, checking status...')
            try {
                const escrowData = parseEscrowAccount(escrowAccountInfo.data)
                console.log('Existing escrow status:', escrowData.status)


                if (escrowData.status === 1) {
                    return c.text('NFT is already listed', 400)
                }


                if (escrowData.status === 0 || escrowData.status === 2 || escrowData.status === 3) {
                    console.log('Closing existing escrow account to reset state...')
                    const closeEscrowIx = new TransactionInstruction({
                        programId: getEscrowProgramId(),
                        keys: [
                            { pubkey: sellerPubkey, isSigner: true, isWritable: true },
                            { pubkey: escrowPDA, isSigner: false, isWritable: true },
                        ],
                        data: Buffer.from(getIDL().instructions[4].discriminator),
                    })
                    tx.add(closeEscrowIx)
                }
            } catch (e) {
                console.error('Error parsing existing escrow account:', e)

                if (escrowAccountInfo.owner.equals(getEscrowProgramId())) {
                    console.log('Account owned by program but parse failed, attempting to close...')
                    const closeEscrowIx = new TransactionInstruction({
                        programId: getEscrowProgramId(),
                        keys: [
                            { pubkey: sellerPubkey, isSigner: true, isWritable: true },
                            { pubkey: escrowPDA, isSigner: false, isWritable: true },
                        ],
                        data: Buffer.from(getIDL().instructions[4].discriminator),
                    })
                    tx.add(closeEscrowIx)
                }
            }
        }

        const createEscrowIx = new TransactionInstruction({
            programId: getEscrowProgramId(),
            keys: [
                { pubkey: sellerPubkey, isSigner: true, isWritable: true },
                { pubkey: assetPubkey, isSigner: false, isWritable: false },
                { pubkey: escrowPDA, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: Buffer.from([
                ...getIDL().instructions[0].discriminator,
                ...new BN(priceNum * 1e9).toArray('le', 8),
                0,
            ]),
        })

        // Use the same RPC URL for UMI (with fallback)
        let umi = getUmi(rpcUrl)
        let asset
        try {
            asset = await fetchAssetV1(umi, umiPublicKey(assetId))
        } catch (umiError: any) {
            // If UMI fetch fails with 401, unauthorized, or AccountNotFoundError, try public RPC
            const errorMsg = umiError.message || String(umiError)
            if (errorMsg.includes('401') || 
                errorMsg.includes('Invalid API key') || 
                errorMsg.includes('Unauthorized') || 
                errorMsg.includes('failed to get info') ||
                errorMsg.includes('AccountNotFoundError') ||
                errorMsg.includes('was not found')) {
                console.log('UMI fetch failed, trying public RPC for asset fetch...', errorMsg.slice(0, 100))
                rpcUrl = 'https://api.devnet.solana.com'
                connection = new Connection(rpcUrl)
                umi = getUmi(rpcUrl)
                asset = await fetchAssetV1(umi, umiPublicKey(assetId))
            } else {
                throw umiError
            }
        }

        const depositAssetKeys = [
            { pubkey: sellerPubkey, isSigner: true, isWritable: true },
            { pubkey: assetPubkey, isSigner: false, isWritable: true },
            { pubkey: escrowPDA, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'), isSigner: false, isWritable: false },
        ]


        if (asset.updateAuthority.type === 'Collection' && asset.updateAuthority.address) {
            depositAssetKeys.push({
                pubkey: new PublicKey(asset.updateAuthority.address.toString()),
                isSigner: false,
                isWritable: false
            })
        }

        if (asset.pluginHeader) {
            depositAssetKeys.push({
                pubkey: new PublicKey(asset.pluginHeader.key),
                isSigner: false,
                isWritable: true
            })
        }

        const depositAssetIx = new TransactionInstruction({
            programId: getEscrowProgramId(),
            keys: depositAssetKeys,
            data: Buffer.from(getIDL().instructions[1].discriminator),
        })

        let blockhash, lastValidBlockHeight
        try {
            const latestBlockhash = await connection.getLatestBlockhash()
            blockhash = latestBlockhash.blockhash
            lastValidBlockHeight = latestBlockhash.lastValidBlockHeight
        } catch (rpcError: any) {
            // If API key is invalid, try public RPC as fallback
            if (rpcError.message?.includes('401') || rpcError.message?.includes('Invalid API key') || rpcError.message?.includes('Unauthorized')) {
                console.log('API key invalid when getting blockhash in listNft, using public RPC...')
                rpcUrl = 'https://api.devnet.solana.com'
                connection = new Connection(rpcUrl)
                const latestBlockhash = await connection.getLatestBlockhash()
                blockhash = latestBlockhash.blockhash
                lastValidBlockHeight = latestBlockhash.lastValidBlockHeight
            } else {
                throw rpcError
            }
        }

        tx.recentBlockhash = blockhash
        tx.lastValidBlockHeight = lastValidBlockHeight
        tx.feePayer = sellerPubkey
        tx.add(createEscrowIx, depositAssetIx)

        const serializedTx = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        const base64Tx = Buffer.from(serializedTx).toString('base64')

        // Track seller in database and create escrow record
        const connectionString = getConnectionString(c.env)
        if (connectionString) {
            try {
                await withPrisma(connectionString, async (prisma) => {
                    const sellerUserId = await ensureUserExists(prisma, seller)
                    console.log('List DB: Seller tracked', seller)
                    
                    // Find NFT in database
                    const nft = await prisma.nft.findUnique({
                        where: { nftId: assetId }
                    })
                    
                    if (nft) {
                        // Check if escrow already exists for this NFT
                        const existingEscrow = await prisma.escrow.findFirst({
                            where: {
                                nftId: nft.id,
                                userId: sellerUserId
                            }
                        })
                        
                        if (existingEscrow) {
                            // Update existing escrow
                            await prisma.escrow.update({
                                where: { id: existingEscrow.id },
                                data: {
                                    status: 'DEPOSITED',
                                    amount: priceNum
                                }
                            })
                            console.log('List DB: Escrow record updated')
                        } else {
                            // Create new escrow
                            await prisma.escrow.create({
                                data: {
                                    userId: sellerUserId,
                                    nftId: nft.id,
                                    amount: priceNum,
                                    status: 'DEPOSITED'
                                }
                            })
                            console.log('List DB: Escrow record created')
                        }
                    }
                })
            } catch (e) {
                console.error('Failed to track seller/escrow in DB:', e)
                // Don't block the transaction
            }
        }

        // Log successful listing transaction
        logBlockchainTransaction({
            action: 'list_nft',
            walletAddress: seller,
            assetId: assetId,
            escrowAddress: escrowPDA.toBase58(),
            success: true
        })

        return c.json({ transaction: base64Tx, escrow: escrowPDA.toBase58() })
    } catch (error) {
        console.error('List NFT error:', error)
        
        // Log failed listing attempt
        logBlockchainTransaction({
            action: 'list_nft',
            walletAddress: 'unknown',
            success: false,
            error: error instanceof Error ? error.message : String(error)
        })
        
        return c.text(`List NFT failed: ${error}`, 500)
    }
}

export const buyNft = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const body = await c.req.json()
        const { assetId, buyer, seller } = body

        if (!assetId || !buyer || !seller) {
            return c.text('Missing assetId, buyer, or seller', 400)
        }

        const assetPubkey = new PublicKey(assetId)
        const buyerPubkey = new PublicKey(buyer)
        const sellerPubkey = new PublicKey(seller)

        const [escrowPDA] = getEscrowPDA(assetPubkey, sellerPubkey)

        // Fetch asset with RPC fallback
        let rpcUrl = c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
        let umi = getUmi(rpcUrl)
        let asset
        try {
            asset = await fetchAssetV1(umi, umiPublicKey(assetId))
        } catch (umiError: any) {
            const errorMsg = umiError.message || String(umiError)
            if (errorMsg.includes('401') || 
                errorMsg.includes('Invalid API key') || 
                errorMsg.includes('Unauthorized') || 
                errorMsg.includes('AccountNotFoundError') ||
                errorMsg.includes('was not found')) {
                console.log('Buy: UMI fetch failed, trying public RPC...', errorMsg.slice(0, 100))
                rpcUrl = 'https://api.devnet.solana.com'
                umi = getUmi(rpcUrl)
                asset = await fetchAssetV1(umi, umiPublicKey(assetId))
            } else {
                throw umiError
            }
        }

        const buyAssetKeys = [
            { pubkey: buyerPubkey, isSigner: true, isWritable: true },
            { pubkey: assetPubkey, isSigner: false, isWritable: true },
            { pubkey: sellerPubkey, isSigner: false, isWritable: true },
            { pubkey: escrowPDA, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'), isSigner: false, isWritable: false },
        ]

        if (asset.updateAuthority.type === 'Collection' && asset.updateAuthority.address) {
            buyAssetKeys.push({
                pubkey: new PublicKey(asset.updateAuthority.address.toString()),
                isSigner: false,
                isWritable: false
            })
        }

        if (asset.pluginHeader) {
            buyAssetKeys.push({
                pubkey: new PublicKey(asset.pluginHeader.key),
                isSigner: false,
                isWritable: true
            })
        }

        const buyAssetIx = new TransactionInstruction({
            programId: getEscrowProgramId(),
            keys: buyAssetKeys,
            data: Buffer.from(getIDL().instructions[2].discriminator),
        })

        const connection = new Connection(rpcUrl)
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()

        const tx = new Transaction()
        tx.recentBlockhash = blockhash
        tx.lastValidBlockHeight = lastValidBlockHeight
        tx.feePayer = buyerPubkey
        tx.add(buyAssetIx)

        const serializedTx = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        const base64Tx = Buffer.from(serializedTx).toString('base64')

        // Track buyer in database and record the purchase
        const connectionString = getConnectionString(c.env)
        if (connectionString) {
            try {
                await withPrisma(connectionString, async (prisma) => {
                    // Ensure buyer exists
                    const buyerUserId = await ensureUserExists(prisma, buyer)
                    console.log('Buy DB: Buyer tracked', buyer)

                    // Also ensure seller exists
                    await ensureUserExists(prisma, seller)

                    // Get escrow price for transaction record
                    // Every other call site defaults to public devnet; this one threw on an
                    // unset secret because new Connection(undefined) rejects the endpoint.
                    const connection = new Connection(c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com')
                    const escrowAccountInfo = await connection.getAccountInfo(escrowPDA)
                    let priceInSol = 0
                    if (escrowAccountInfo) {
                        const escrowData = parseEscrowAccount(escrowAccountInfo.data)
                        priceInSol = Number(escrowData.price) / 1e9
                    }

                    // Find NFT in database by on-chain ID
                    const nft = await prisma.nft.findUnique({
                        where: { nftId: assetId }
                    })

                    // Record the purchase transaction
                            await prisma.transaction.create({
                                data: {
                                    transactionId: `buy_${assetId}_${Date.now()}`,
                                    userId: buyerUserId,
                                    amount: priceInSol,
                                    nftId: nft?.id || null,
                                    transactionType: 'PURCHASE',
                                    status: 'PENDING', // Will be COMPLETED after on-chain confirmation
                                    walletAddress: buyer,
                                    txHash: null,
                                    currency: 'SOL',
                                    network: 'solana',
                                    metadata: JSON.stringify({
                                        source: 'escrow_purchase',
                                        assetId: assetId,
                                        seller: seller,
                                        price: priceInSol
                                    })
                                } as any
                            })
                    console.log('Buy DB: Transaction recorded')
                })
            } catch (e) {
                console.error('Failed to track buyer in DB:', e)
                // Don't block the transaction
            }
        }

        // Log successful buy transaction
        logBlockchainTransaction({
            action: 'buy_nft',
            walletAddress: buyer,
            assetId: assetId,
            success: true
        })

        return c.json({ transaction: base64Tx })
    } catch (error) {
        console.error('Buy NFT error:', error)
        
        // Log failed buy attempt
        logBlockchainTransaction({
            action: 'buy_nft',
            walletAddress: 'unknown',
            success: false,
            error: error instanceof Error ? error.message : String(error)
        })
        
        return c.text(`Buy NFT failed: ${error}`, 500)
    }
}

export const cancelListing = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const body = await c.req.json()
        const { assetId, seller } = body

        if (!assetId || !seller) {
            return c.text('Missing assetId or seller', 400)
        }

        const assetPubkey = new PublicKey(assetId)
        const sellerPubkey = new PublicKey(seller)

        const [escrowPDA] = getEscrowPDA(assetPubkey, sellerPubkey)

        // Fetch asset with RPC fallback
        let rpcUrl = c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
        let umi = getUmi(rpcUrl)
        let asset
        try {
            asset = await fetchAssetV1(umi, umiPublicKey(assetId))
        } catch (umiError: any) {
            const errorMsg = umiError.message || String(umiError)
            if (errorMsg.includes('401') || 
                errorMsg.includes('Invalid API key') || 
                errorMsg.includes('Unauthorized') || 
                errorMsg.includes('AccountNotFoundError') ||
                errorMsg.includes('was not found')) {
                console.log('Cancel: UMI fetch failed, trying public RPC...', errorMsg.slice(0, 100))
                rpcUrl = 'https://api.devnet.solana.com'
                umi = getUmi(rpcUrl)
                asset = await fetchAssetV1(umi, umiPublicKey(assetId))
            } else {
                throw umiError
            }
        }

        const cancelEscrowKeys = [
            { pubkey: sellerPubkey, isSigner: true, isWritable: true },
            { pubkey: assetPubkey, isSigner: false, isWritable: true },
            { pubkey: escrowPDA, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'), isSigner: false, isWritable: false },
        ]

        if (asset.updateAuthority.type === 'Collection' && asset.updateAuthority.address) {
            cancelEscrowKeys.push({
                pubkey: new PublicKey(asset.updateAuthority.address.toString()),
                isSigner: false,
                isWritable: false
            })
        }

        if (asset.pluginHeader) {
            cancelEscrowKeys.push({
                pubkey: new PublicKey(asset.pluginHeader.key),
                isSigner: false,
                isWritable: true
            })
        }

        const cancelEscrowIx = new TransactionInstruction({
            programId: getEscrowProgramId(),
            keys: cancelEscrowKeys,
            data: Buffer.from(getIDL().instructions[3].discriminator),
        })

        const connection = new Connection(rpcUrl)
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()

        const tx = new Transaction()
        tx.recentBlockhash = blockhash
        tx.lastValidBlockHeight = lastValidBlockHeight
        tx.feePayer = sellerPubkey
        tx.add(cancelEscrowIx)

        const serializedTx = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        const base64Tx = Buffer.from(serializedTx).toString('base64')

        // Update escrow status in database
        const connectionString = getConnectionString(c.env)
        if (connectionString) {
            try {
                await withPrisma(connectionString, async (prisma) => {
                    // Find escrow by NFT and seller
                    const nft = await prisma.nft.findUnique({
                        where: { nftId: assetId }
                    })
                    
                    if (nft) {
                        const sellerUserId = await ensureUserExists(prisma, seller)
                        const escrow = await prisma.escrow.findFirst({
                            where: {
                                nftId: nft.id,
                                userId: sellerUserId
                            }
                        })
                        
                        if (escrow) {
                            await prisma.escrow.update({
                                where: { id: escrow.id },
                                data: { status: 'CANCELLED' }
                            })
                            console.log('Cancel DB: Escrow status updated to CANCELLED')
                        }
                    }
                })
            } catch (e) {
                console.error('Failed to update escrow status:', e)
                // Don't block the transaction
            }
        }

        // Log successful cancel transaction
        logBlockchainTransaction({
            action: 'cancel_listing',
            walletAddress: seller,
            assetId: assetId,
            success: true
        })

        return c.json({ transaction: base64Tx })
    } catch (error) {
        console.error('Cancel listing error:', error)
        
        // Log failed cancel attempt
        logBlockchainTransaction({
            action: 'cancel_listing',
            walletAddress: 'unknown',
            success: false,
            error: error instanceof Error ? error.message : String(error)
        })
        
        return c.text(`Cancel listing failed: ${error}`, 500)
    }
}

export const adminResolveEscrow = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const body = await c.req.json()
        const { assetId, seller, buyer, admin, refundBuyer } = body

        if (!assetId || !seller || !buyer || !admin) {
            return c.text('Missing required fields: assetId, seller, buyer, admin', 400)
        }

        if (typeof refundBuyer !== 'boolean') {
            return c.text('refundBuyer must be a boolean', 400)
        }

        const assetPubkey = new PublicKey(assetId)
        const sellerPubkey = new PublicKey(seller)
        const buyerPubkey = new PublicKey(buyer)
        const adminPubkey = new PublicKey(admin)

        const [escrowPDA] = getEscrowPDA(assetPubkey, sellerPubkey)

        // Fetch asset with RPC fallback
        let rpcUrl = c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
        let umi = getUmi(rpcUrl)
        let asset
        try {
            asset = await fetchAssetV1(umi, umiPublicKey(assetId))
        } catch (umiError: any) {
            const errorMsg = umiError.message || String(umiError)
            if (errorMsg.includes('401') || 
                errorMsg.includes('Invalid API key') || 
                errorMsg.includes('Unauthorized') || 
                errorMsg.includes('AccountNotFoundError') ||
                errorMsg.includes('was not found')) {
                console.log('AdminResolve: UMI fetch failed, trying public RPC...', errorMsg.slice(0, 100))
                rpcUrl = 'https://api.devnet.solana.com'
                umi = getUmi(rpcUrl)
                asset = await fetchAssetV1(umi, umiPublicKey(assetId))
            } else {
                throw umiError
            }
        }

        const adminResolveKeys = [
            { pubkey: adminPubkey, isSigner: true, isWritable: true },
            { pubkey: sellerPubkey, isSigner: false, isWritable: true },
            { pubkey: buyerPubkey, isSigner: false, isWritable: true },
            { pubkey: assetPubkey, isSigner: false, isWritable: true },
            { pubkey: escrowPDA, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'), isSigner: false, isWritable: false },
        ]

        if (asset.updateAuthority.type === 'Collection' && asset.updateAuthority.address) {
            adminResolveKeys.push({
                pubkey: new PublicKey(asset.updateAuthority.address.toString()),
                isSigner: false,
                isWritable: false
            })
        }

        if (asset.pluginHeader) {
            adminResolveKeys.push({
                pubkey: new PublicKey(asset.pluginHeader.key),
                isSigner: false,
                isWritable: true
            })
        }

        // Build instruction data: discriminator + refund_buyer (bool = 1 byte)
        const refundBuyerByte = refundBuyer ? 1 : 0
        const discriminator = getIDL().instructions[5].discriminator
        const discriminatorArray = Array.isArray(discriminator) ? discriminator : Array.from(discriminator)
        const instructionData = Buffer.concat([
            Buffer.from(discriminatorArray as number[]) as any,
            Buffer.from([refundBuyerByte]) as any
        ]) as Buffer

        const adminResolveIx = new TransactionInstruction({
            programId: getEscrowProgramId(),
            keys: adminResolveKeys,
            data: instructionData,
        })

        const connection = new Connection(rpcUrl)
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()

        const tx = new Transaction()
        tx.recentBlockhash = blockhash
        tx.lastValidBlockHeight = lastValidBlockHeight
        tx.feePayer = adminPubkey
        tx.add(adminResolveIx)

        const serializedTx = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        const base64Tx = Buffer.from(serializedTx).toString('base64')

        return c.json({ transaction: base64Tx })
    } catch (error) {
        console.error('Admin resolve escrow error:', error)
        return c.text(`Admin resolve failed: ${error}`, 500)
    }
}
