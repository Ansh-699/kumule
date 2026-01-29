import { Context } from 'hono'
import { getUmi, withPriorityFees } from './umi'
import { generateSigner, publicKey, createSignerFromKeypair, keypairIdentity } from '@metaplex-foundation/umi'
import { createV1 } from '@metaplex-foundation/mpl-core'
import { withPrisma, getConnectionString } from './db'
import { base58 } from '@metaplex-foundation/umi/serializers'

interface RewardConfig {
    goldSupply: number
    goldPoints: number
    goldName: string
    goldImageUrl: string | null
    silverSupply: number
    silverPoints: number
    silverName: string
    silverImageUrl: string | null
    bronzeSupply: number
    bronzePoints: number
    bronzeName: string
    bronzeImageUrl: string | null
}

interface MintResult {
    medalType: string
    nftAsset: string
    txHash: string
    success: boolean
    error?: string
}

// Default medal images hosted on R2
const DEFAULT_MEDAL_IMAGES = {
    GOLD: 'https://pub-0ae00b868fc94b2e84d498b934463cc0.r2.dev/rewards/gold-medal.png',
    SILVER: 'https://pub-0ae00b868fc94b2e84d498b934463cc0.r2.dev/rewards/silver-medal.png',
    BRONZE: 'https://pub-0ae00b868fc94b2e84d498b934463cc0.r2.dev/rewards/bronze-medal.png'
}

/**
 * Generate and upload metadata for reward NFT to R2
 */
async function generateRewardMetadata(
    env: CloudflareBindings,
    eventName: string,
    medalType: string,
    medalName: string,
    imageUrl: string | null,
    index: number
): Promise<{ metadataUri: string; imageUrl: string }> {
    const finalImageUrl = imageUrl || DEFAULT_MEDAL_IMAGES[medalType as keyof typeof DEFAULT_MEDAL_IMAGES]
    
    const metadata = {
        name: `${eventName} - ${medalName} #${index + 1}`,
        symbol: medalType.substring(0, 3),
        description: `${medalName} reward for participating in ${eventName}. This exclusive NFT is awarded to participants who achieved this milestone.`,
        image: finalImageUrl,
        external_url: 'https://kumele.ansht.workers.dev',
        attributes: [
            { trait_type: 'Medal Type', value: medalType },
            { trait_type: 'Event', value: eventName },
            { trait_type: 'Rarity', value: medalType === 'GOLD' ? 'Legendary' : medalType === 'SILVER' ? 'Rare' : 'Common' },
            { trait_type: 'Edition', value: `#${index + 1}` }
        ],
        properties: {
            category: 'image',
            files: [{ uri: finalImageUrl, type: 'image/png' }],
            creators: []
        }
    }
    
    // Upload metadata to R2
    const metadataJson = JSON.stringify(metadata)
    const metadataKey = `metadata/event-rewards/${Date.now()}-${medalType.toLowerCase()}-${index}.json`
    
    if (env.NFT_BUCKET) {
        try {
            await env.NFT_BUCKET.put(metadataKey, metadataJson, {
                httpMetadata: { contentType: 'application/json' }
            })
            const metadataUri = `https://pub-0ae00b868fc94b2e84d498b934463cc0.r2.dev/${metadataKey}`
            return { metadataUri, imageUrl: finalImageUrl }
        } catch (e) {
            console.error('Failed to upload metadata to R2:', e)
        }
    }
    
    // Fallback: use a data URI or placeholder (not ideal for production)
    console.warn('R2 bucket not available, using inline metadata')
    const base64Metadata = Buffer.from(metadataJson).toString('base64')
    return { 
        metadataUri: `data:application/json;base64,${base64Metadata}`,
        imageUrl: finalImageUrl 
    }
}

/**
 * Mint a single reward NFT using admin wallet private key
 * Includes retry logic for transient failures
 */
async function mintSingleRewardNft(
    env: CloudflareBindings,
    eventName: string,
    medalType: string,
    medalName: string,
    imageUrl: string | null,
    index: number,
    maxRetries: number = 3
): Promise<MintResult> {
    const privateKeyBase58 = env.ADMIN_WALLET_PRIVATE_KEY
    if (!privateKeyBase58) {
        return {
            medalType,
            nftAsset: '',
            txHash: '',
            success: false,
            error: 'ADMIN_WALLET_PRIVATE_KEY not configured in environment'
        }
    }

    // Use Helius RPC if available, fallback to devnet
    const rpcUrl = env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
    console.log(`Using RPC: ${rpcUrl.substring(0, 50)}...`)
    
    // STEP 1: Generate metadata and upload to R2 FIRST (before getting blockhash)
    // This is the slow operation that was causing blockhash to become stale
    console.log(`Uploading metadata for ${medalType} NFT #${index + 1}...`)
    let metadataUri: string
    let finalImageUrl: string
    try {
        const metadata = await generateRewardMetadata(
            env,
            eventName,
            medalType,
            medalName,
            imageUrl,
            index
        )
        metadataUri = metadata.metadataUri
        finalImageUrl = metadata.imageUrl
        console.log(`Metadata uploaded: ${metadataUri.substring(0, 60)}...`)
    } catch (uploadError: any) {
        console.error(`Failed to upload metadata:`, uploadError.message)
        return {
            medalType,
            nftAsset: '',
            txHash: '',
            success: false,
            error: `Metadata upload failed: ${uploadError.message}`
        }
    }
    
    // STEP 2: Now set up umi and mint (with fresh blockhash)
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Create fresh umi instance for each attempt
            let umi = getUmi(rpcUrl)
            
            // Decode private key and create keypair
            const privateKeyBytes = base58.serialize(privateKeyBase58)
            const adminKeypair = umi.eddsa.createKeypairFromSecretKey(privateKeyBytes)
            
            // Set admin as identity and payer
            umi = umi.use(keypairIdentity(adminKeypair))
            
            // Create NFT asset
            const asset = generateSigner(umi)
            const nftName = `${eventName} - ${medalName} #${index + 1}`
            
            console.log(`Minting ${medalType} NFT #${index + 1}: ${nftName} (attempt ${attempt}/${maxRetries})`)
            
            // Build create transaction - blockhash is fetched here
            const builder = createV1(umi, {
                asset,
                name: nftName,
                uri: metadataUri,
                owner: umi.identity.publicKey, // Admin wallet owns the NFT initially
            })
            
            // Build, sign and send transaction manually for better control
            console.log(`Sending transaction...`)
            
            // Get fresh blockhash right before signing
            const { blockhash, lastValidBlockHeight } = await umi.rpc.getLatestBlockhash()
            
            // Build transaction with fresh blockhash
            const tx = await builder.setBlockhash(blockhash).buildAndSign(umi)
            
            // Send raw transaction
            const signature = await umi.rpc.sendTransaction(tx, { 
                skipPreflight: true,
                maxRetries: 5
            })
            const txHash = base58.deserialize(signature)[0]
            console.log(`Transaction sent: ${txHash}`)
            
            // Try to confirm with short timeout, but don't fail if confirmation times out
            // The transaction may still land even if confirmation times out
            try {
                await umi.rpc.confirmTransaction(signature, {
                    strategy: { type: 'blockhash', blockhash, lastValidBlockHeight },
                    commitment: 'processed'
                })
                console.log(`✓ Confirmed ${medalType} NFT: ${asset.publicKey.toString()}`)
            } catch (confirmError: any) {
                // Check if transaction actually landed despite confirmation error
                console.log(`Confirmation warning: ${confirmError.message?.substring(0, 50)}`)
                
                // Wait a bit and check if the asset exists
                await new Promise(r => setTimeout(r, 2000))
                
                try {
                    const accountInfo = await umi.rpc.getAccount(asset.publicKey)
                    if (accountInfo.exists) {
                        console.log(`✓ Asset verified on-chain: ${asset.publicKey.toString()}`)
                    } else {
                        throw new Error('Asset not found on-chain after send')
                    }
                } catch (verifyError: any) {
                    throw new Error(`Transaction sent but asset not verified: ${verifyError.message}`)
                }
            }
            
            console.log(`✓ Minted ${medalType} NFT: ${asset.publicKey.toString()} (tx: ${txHash})`)
            
            return {
                medalType,
                nftAsset: asset.publicKey.toString(),
                txHash,
                success: true
            }
        } catch (error: any) {
            const isRetryable = error.message?.includes('block height') || 
                               error.message?.includes('expired') ||
                               error.message?.includes('timeout') ||
                               error.message?.includes('429')
            
            console.error(`✗ Attempt ${attempt}/${maxRetries} failed for ${medalType} NFT #${index + 1}:`, error.message)
            
            if (attempt < maxRetries && isRetryable) {
                // Wait before retry with exponential backoff
                const delay = Math.min(2000 * Math.pow(2, attempt - 1), 10000)
                console.log(`   Retrying in ${delay}ms...`)
                await new Promise(r => setTimeout(r, delay))
                continue
            }
            
            return {
                medalType,
                nftAsset: '',
                txHash: '',
                success: false,
                error: error.message
            }
        }
    }
    
    return {
        medalType,
        nftAsset: '',
        txHash: '',
        success: false,
        error: 'Max retries exceeded'
    }
}

/**
 * Auto-mint all reward NFTs for an event (Gold, Silver, Bronze)
 * This runs in the background after event creation
 */
export async function autoMintEventRewards(
    env: CloudflareBindings,
    eventId: string,
    eventName: string,
    config: RewardConfig
): Promise<{ success: boolean; minted: MintResult[]; errors: string[] }> {
    const results: MintResult[] = []
    const errors: string[] = []
    
    const connectionString = getConnectionString(env)
    if (!connectionString) {
        return { success: false, minted: [], errors: ['Database not configured'] }
    }
    
    const totalToMint = config.goldSupply + config.silverSupply + config.bronzeSupply
    
    // Update minting status to MINTING
    try {
        await withPrisma(connectionString, async (prisma) => {
            await prisma.eventRewardConfig.update({
                where: { eventId },
                data: { 
                    mintingStatus: 'MINTING',
                    totalToMint 
                }
            })
        })
    } catch (e: any) {
        console.error('Failed to update minting status:', e)
    }
    
    let mintedCount = 0
    
    try {
        // Mint Gold NFTs
        console.log(`\n=== Minting ${config.goldSupply} Gold NFTs for event: ${eventName} ===`)
        for (let i = 0; i < config.goldSupply; i++) {
            const result = await mintSingleRewardNft(
                env, eventName, 'GOLD', config.goldName, config.goldImageUrl, i
            )
            results.push(result)
            
            if (result.success) {
                mintedCount++
                // Save to database
                await withPrisma(connectionString, async (prisma) => {
                    await prisma.eventRewardNft.create({
                        data: {
                            eventId,
                            medalType: 'GOLD',
                            name: `${eventName} - ${config.goldName} #${i + 1}`,
                            description: `Gold medal reward for ${eventName}`,
                            imageUrl: config.goldImageUrl || DEFAULT_MEDAL_IMAGES.GOLD,
                            metadataUri: '', // Will be updated if needed
                            nftAsset: result.nftAsset,
                            requiredPoints: config.goldPoints,
                            totalSupply: 1,
                            isActive: true
                        }
                    })
                    
                    // Update minted count
                    await prisma.eventRewardConfig.update({
                        where: { eventId },
                        data: { mintedCount }
                    })
                })
            } else {
                errors.push(`Gold #${i + 1}: ${result.error}`)
            }
            
            // Add delay between mints to avoid rate limiting
            if (i < config.goldSupply - 1) {
                await new Promise(resolve => setTimeout(resolve, 1500))
            }
        }
        
        // Mint Silver NFTs
        console.log(`\n=== Minting ${config.silverSupply} Silver NFTs for event: ${eventName} ===`)
        for (let i = 0; i < config.silverSupply; i++) {
            const result = await mintSingleRewardNft(
                env, eventName, 'SILVER', config.silverName, config.silverImageUrl, i
            )
            results.push(result)
            
            if (result.success) {
                mintedCount++
                await withPrisma(connectionString, async (prisma) => {
                    await prisma.eventRewardNft.create({
                        data: {
                            eventId,
                            medalType: 'SILVER',
                            name: `${eventName} - ${config.silverName} #${i + 1}`,
                            description: `Silver medal reward for ${eventName}`,
                            imageUrl: config.silverImageUrl || DEFAULT_MEDAL_IMAGES.SILVER,
                            metadataUri: '',
                            nftAsset: result.nftAsset,
                            requiredPoints: config.silverPoints,
                            totalSupply: 1,
                            isActive: true
                        }
                    })
                    
                    await prisma.eventRewardConfig.update({
                        where: { eventId },
                        data: { mintedCount }
                    })
                })
            } else {
                errors.push(`Silver #${i + 1}: ${result.error}`)
            }
            
            if (i < config.silverSupply - 1) {
                await new Promise(resolve => setTimeout(resolve, 1500))
            }
        }
        
        // Mint Bronze NFTs
        console.log(`\n=== Minting ${config.bronzeSupply} Bronze NFTs for event: ${eventName} ===`)
        for (let i = 0; i < config.bronzeSupply; i++) {
            const result = await mintSingleRewardNft(
                env, eventName, 'BRONZE', config.bronzeName, config.bronzeImageUrl, i
            )
            results.push(result)
            
            if (result.success) {
                mintedCount++
                await withPrisma(connectionString, async (prisma) => {
                    await prisma.eventRewardNft.create({
                        data: {
                            eventId,
                            medalType: 'BRONZE',
                            name: `${eventName} - ${config.bronzeName} #${i + 1}`,
                            description: `Bronze medal reward for ${eventName}`,
                            imageUrl: config.bronzeImageUrl || DEFAULT_MEDAL_IMAGES.BRONZE,
                            metadataUri: '',
                            nftAsset: result.nftAsset,
                            requiredPoints: config.bronzePoints,
                            totalSupply: 1,
                            isActive: true
                        }
                    })
                    
                    await prisma.eventRewardConfig.update({
                        where: { eventId },
                        data: { mintedCount }
                    })
                })
            } else {
                errors.push(`Bronze #${i + 1}: ${result.error}`)
            }
            
            if (i < config.bronzeSupply - 1) {
                await new Promise(resolve => setTimeout(resolve, 1500))
            }
        }
        
        // Update final status
        const allSuccess = results.every(r => r.success)
        const someSuccess = results.some(r => r.success)
        
        await withPrisma(connectionString, async (prisma) => {
            await prisma.eventRewardConfig.update({
                where: { eventId },
                data: {
                    mintingStatus: allSuccess ? 'COMPLETED' : (someSuccess ? 'PARTIAL' : 'FAILED'),
                    mintingError: errors.length > 0 ? errors.join('; ') : null,
                    mintedCount
                }
            })
        })
        
        console.log(`\n=== Auto-mint completed for ${eventName} ===`)
        console.log(`Total: ${mintedCount}/${totalToMint} NFTs minted successfully`)
        
        return { success: allSuccess, minted: results, errors }
        
    } catch (error: any) {
        console.error('Auto-mint failed with error:', error)
        
        // Update error status
        await withPrisma(connectionString, async (prisma) => {
            await prisma.eventRewardConfig.update({
                where: { eventId },
                data: {
                    mintingStatus: 'FAILED',
                    mintingError: error.message,
                    mintedCount
                }
            })
        })
        
        return { success: false, minted: results, errors: [...errors, error.message] }
    }
}

/**
 * Get the minting status for an event's reward NFTs
 */
export const getEventRewardStatus = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const eventId = c.req.param('id')
        
        if (!eventId) {
            return c.json({ error: 'Event ID is required' }, 400)
        }
        
        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }
        
        const result = await withPrisma(connectionString, async (prisma) => {
            const config = await prisma.eventRewardConfig.findUnique({
                where: { eventId }
            })
            
            const rewards = await prisma.eventRewardNft.findMany({
                where: { eventId },
                orderBy: [
                    { medalType: 'asc' },
                    { createdAt: 'asc' }
                ],
                include: {
                    claims: {
                        select: {
                            id: true,
                            walletAddress: true,
                            claimedAt: true
                        }
                    }
                }
            })
            
            // Group rewards by medal type
            const grouped = {
                gold: rewards.filter(r => r.medalType === 'GOLD'),
                silver: rewards.filter(r => r.medalType === 'SILVER'),
                bronze: rewards.filter(r => r.medalType === 'BRONZE')
            }
            
            return { config, rewards, grouped }
        })
        
        return c.json(result)
        
    } catch (e: any) {
        console.error('Get event reward status error:', e)
        return c.json({ error: e.message }, 500)
    }
}

/**
 * Manually retry minting for failed event rewards
 */
export const retryEventRewardMinting = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const eventId = c.req.param('id')
        
        if (!eventId) {
            return c.json({ error: 'Event ID is required' }, 400)
        }
        
        const connectionString = getConnectionString(c.env)
        if (!connectionString) {
            return c.json({ error: 'Database not configured' }, 500)
        }
        
        // Get event and config
        const eventData = await withPrisma(connectionString, async (prisma) => {
            const event = await prisma.event.findUnique({
                where: { id: eventId },
                include: { rewardConfig: true }
            })
            return event
        })
        
        if (!eventData) {
            return c.json({ error: 'Event not found' }, 404)
        }
        
        if (!eventData.rewardConfig) {
            return c.json({ error: 'No reward config found for this event' }, 404)
        }
        
        const config = eventData.rewardConfig
        
        // Trigger auto-mint in background
        c.executionCtx.waitUntil(
            autoMintEventRewards(c.env, eventId, eventData.name, {
                goldSupply: config.goldSupply,
                goldPoints: config.goldPoints,
                goldName: config.goldName,
                goldImageUrl: config.goldImageUrl,
                silverSupply: config.silverSupply,
                silverPoints: config.silverPoints,
                silverName: config.silverName,
                silverImageUrl: config.silverImageUrl,
                bronzeSupply: config.bronzeSupply,
                bronzePoints: config.bronzePoints,
                bronzeName: config.bronzeName,
                bronzeImageUrl: config.bronzeImageUrl,
            }).then(result => {
                console.log(`Retry mint for event ${eventId} completed:`, result.success ? 'SUCCESS' : 'FAILED')
            }).catch(err => {
                console.error(`Retry mint for event ${eventId} failed:`, err)
            })
        )
        
        return c.json({ 
            success: true, 
            message: 'Minting retry started in background',
            eventId 
        })
        
    } catch (e: any) {
        console.error('Retry event reward minting error:', e)
        return c.json({ error: e.message }, 500)
    }
}
