// Base Sepolia reads and event indexing. The mirror of what escrow.ts does for Solana.
//
// Read-only by design: the worker never holds a user's EVM key. Listing, buying and minting
// are wallet-signed in the browser through wagmi/OnchainKit; the backend's job is to observe
// what landed and keep the database in step.

import { createPublicClient, http, parseAbi, type PublicClient, type Address } from 'viem'
import { baseSepolia } from 'viem/chains'
import { evmRpc, EVM_CHAIN_ID, fromBaseUnits, makeAssetId } from './chains'

export const NFT_ABI = parseAbi([
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function totalMinted() view returns (uint256)',
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function mintFee() view returns (uint256)',
    'function isApprovedForAll(address owner, address operator) view returns (bool)',
    'event Minted(uint256 indexed tokenId, address indexed to, string uri)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
])

export const MARKET_ABI = parseAbi([
    'function listings(uint256) view returns (address seller, address nft, uint256 tokenId, uint256 price, bool active)',
    'function activeListingOf(address nft, uint256 tokenId) view returns (uint256)',
    'function totalListings() view returns (uint256)',
    'function isFillable(uint256 listingId) view returns (bool)',
    'function feeBps() view returns (uint96)',
    'event Listed(uint256 indexed listingId, address indexed seller, address indexed nft, uint256 tokenId, uint256 price)',
    'event Cancelled(uint256 indexed listingId)',
    'event Purchased(uint256 indexed listingId, address indexed buyer, address indexed seller, address nft, uint256 tokenId, uint256 price, uint256 fee)',
    'event PriceUpdated(uint256 indexed listingId, uint256 oldPrice, uint256 newPrice)',
])

export type EvmContracts = { nft: Address; market: Address }

/**
 * Deployed addresses. Env overrides exist so a redeploy does not need a code change, but the
 * defaults are the live Base Sepolia proxies so the worker works with no extra config.
 */
export const evmContracts = (env: CloudflareBindings): EvmContracts => ({
    nft: (env.EVM_NFT_ADDRESS || '0x416e7Fd93fc2210540AAC1c1cC17a851148DfEBD') as Address,
    market: (env.EVM_MARKET_ADDRESS || '0x032774De36621265dc21056026372D7bA6f477eC') as Address,
})

export const evmClient = (env: CloudflareBindings): PublicClient =>
    createPublicClient({ chain: baseSepolia, transport: http(evmRpc(env)) }) as PublicClient

// --- single asset ---

export type EvmAsset = {
    assetId: string
    chain: 'ETHEREUM'
    chainId: number
    contractAddress: string
    tokenId: string
    ownerAddress: string
    tokenUri: string
}

/**
 * Read one token straight from chain. Returns null when the token does not exist, because
 * `ownerOf` on an unminted id reverts and "absent" is a normal answer, not a failure.
 */
export const readAsset = async (
    env: CloudflareBindings,
    contract: Address,
    tokenId: bigint
): Promise<EvmAsset | null> => {
    const client = evmClient(env)
    try {
        const [owner, uri] = await Promise.all([
            client.readContract({ address: contract, abi: NFT_ABI, functionName: 'ownerOf', args: [tokenId] }),
            client.readContract({ address: contract, abi: NFT_ABI, functionName: 'tokenURI', args: [tokenId] }),
        ])
        return {
            assetId: makeAssetId('ETHEREUM', { contractAddress: contract, tokenId }),
            chain: 'ETHEREUM',
            chainId: EVM_CHAIN_ID,
            contractAddress: contract.toLowerCase(),
            tokenId: tokenId.toString(),
            ownerAddress: (owner as string).toLowerCase(),
            tokenUri: uri as string,
        }
    } catch {
        return null
    }
}

/** Total supply of the Kumule collection, or 0 if the call fails. */
export const totalMinted = async (env: CloudflareBindings): Promise<bigint> => {
    try {
        return (await evmClient(env).readContract({
            address: evmContracts(env).nft,
            abi: NFT_ABI,
            functionName: 'totalMinted',
        })) as bigint
    } catch (e) {
        console.error('evm totalMinted failed:', e)
        return 0n
    }
}

// --- listings ---

export type EvmListing = {
    listingId: string
    seller: string
    contractAddress: string
    tokenId: string
    assetId: string
    /** Decimal ETH string, never a float. */
    price: string
    priceWei: string
    active: boolean
}

export const readListing = async (
    env: CloudflareBindings,
    listingId: bigint
): Promise<EvmListing | null> => {
    try {
        const r = (await evmClient(env).readContract({
            address: evmContracts(env).market,
            abi: MARKET_ABI,
            functionName: 'listings',
            args: [listingId],
        })) as readonly [Address, Address, bigint, bigint, boolean]

        const [seller, nft, tokenId, price, active] = r
        // A never-created listing reads back as the zero struct rather than reverting.
        if (seller === '0x0000000000000000000000000000000000000000') return null

        return {
            listingId: listingId.toString(),
            seller: seller.toLowerCase(),
            contractAddress: nft.toLowerCase(),
            tokenId: tokenId.toString(),
            assetId: makeAssetId('ETHEREUM', { contractAddress: nft, tokenId }),
            price: fromBaseUnits(price, 'ETHEREUM'),
            priceWei: price.toString(),
            active,
        }
    } catch (e) {
        console.error(`evm readListing(${listingId}) failed:`, e)
        return null
    }
}

/**
 * Every listing the marketplace has ever created, newest first.
 *
 * Walks ids backwards from totalListings rather than scanning logs: ids are dense and start
 * at 1, so this needs no fromBlock and cannot miss a listing to log pruning. Fine at devnet
 * volume; swap to an event index if listing counts ever reach five figures.
 */
export const listAllListings = async (
    env: CloudflareBindings,
    opts: { limit?: number; activeOnly?: boolean } = {}
): Promise<EvmListing[]> => {
    const limit = Math.min(opts.limit ?? 100, 500)
    const total = (await evmClient(env).readContract({
        address: evmContracts(env).market,
        abi: MARKET_ABI,
        functionName: 'totalListings',
    }).catch(() => 0n)) as bigint

    if (total === 0n) return []

    const out: EvmListing[] = []
    // ponytail: sequential reads, one RPC round-trip per listing. Batch via multicall if
    // listing counts grow past a few hundred.
    for (let id = total; id >= 1n && out.length < limit; id--) {
        const l = await readListing(env, id)
        if (!l) continue
        if (opts.activeOnly && !l.active) continue
        out.push(l)
    }
    return out
}

// --- transaction verification ---

/**
 * Confirm a transaction landed and succeeded. Fails closed: an unreachable RPC, a missing
 * receipt or a reverted transaction all return false, never an optimistic true.
 */
export const verifyEvmTransaction = async (
    env: CloudflareBindings,
    txHash: string
): Promise<boolean> => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return false
    try {
        const receipt = await evmClient(env).getTransactionReceipt({ hash: txHash as `0x${string}` })
        return receipt.status === 'success'
    } catch (e) {
        console.error('evm verify failed:', e)
        return false
    }
}

/**
 * Pull the token id out of a mint receipt. Reading `totalMinted` after the fact is unsafe:
 * a lagging node returns a stale count, and feeding that forward targets the wrong token -
 * exactly the failure the first live Base Sepolia run hit.
 */
export const tokenIdFromMintReceipt = async (
    env: CloudflareBindings,
    txHash: string
): Promise<string | null> => {
    try {
        const client = evmClient(env)
        const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` })
        if (receipt.status !== 'success') return null

        const logs = await client.getContractEvents({
            abi: NFT_ABI,
            eventName: 'Minted',
            blockHash: receipt.blockHash,
        })
        const mine = logs.find((l) => l.transactionHash?.toLowerCase() === txHash.toLowerCase())
        const tokenId = (mine?.args as { tokenId?: bigint } | undefined)?.tokenId
        return tokenId === undefined ? null : tokenId.toString()
    } catch (e) {
        console.error('evm tokenIdFromMintReceipt failed:', e)
        return null
    }
}
