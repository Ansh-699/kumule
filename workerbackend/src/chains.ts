// The one place that knows how the two chains differ.
//
// Everything downstream - routes, indexer, admin - takes a Chain and an assetId and stays
// chain-agnostic. v1 had Solana assumptions spread across 24 files; adding a second chain
// there would have meant touching all of them.

export type Chain = 'SOLANA' | 'ETHEREUM'

export const CHAINS: readonly Chain[] = ['SOLANA', 'ETHEREUM'] as const

/** Base Sepolia. The display chain stays ETHEREUM; only this number moves if we change L2. */
export const EVM_CHAIN_ID = 84532

export type ChainConfig = {
    chain: Chain
    label: string
    currency: 'SOL' | 'ETH'
    /** Wei for EVM, lamports for Solana. */
    decimals: number
    explorerTx: (hash: string) => string
    explorerAddress: (address: string) => string
}

export const CHAIN_CONFIG: Record<Chain, ChainConfig> = {
    SOLANA: {
        chain: 'SOLANA',
        label: 'Solana',
        currency: 'SOL',
        decimals: 9,
        explorerTx: (h) => `https://explorer.solana.com/tx/${h}?cluster=devnet`,
        explorerAddress: (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`,
    },
    ETHEREUM: {
        chain: 'ETHEREUM',
        label: 'Ethereum',
        currency: 'ETH',
        decimals: 18,
        explorerTx: (h) => `https://sepolia.basescan.org/tx/${h}`,
        explorerAddress: (a) => `https://sepolia.basescan.org/address/${a}`,
    },
}

export const isChain = (v: unknown): v is Chain =>
    typeof v === 'string' && (CHAINS as readonly string[]).includes(v)

/**
 * Accepts what a client might plausibly send for a chain and normalises it, so callers do
 * not each invent their own alias table. Returns null when it is not a chain at all, which
 * callers should treat as "no chain filter" rather than an error.
 */
export const parseChain = (v: unknown): Chain | null => {
    if (typeof v !== 'string') return null
    const s = v.trim().toUpperCase()
    if (s === 'SOLANA' || s === 'SOL') return 'SOLANA'
    if (s === 'ETHEREUM' || s === 'ETH' || s === 'EVM' || s === 'BASE') return 'ETHEREUM'
    return null
}

// --- address shapes ---

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
// Base58, 32 bytes: 32-44 chars in practice.
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export const isEvmAddress = (a: string): boolean => EVM_ADDRESS.test(a)
export const isSolanaAddress = (a: string): boolean => SOLANA_ADDRESS.test(a)

export const isValidAddress = (chain: Chain, address: string): boolean =>
    chain === 'ETHEREUM' ? isEvmAddress(address) : isSolanaAddress(address)

/**
 * Infers the chain from an address shape. Useful when a client sends only a wallet, but it
 * is a hint, not authority - always prefer an explicit chain when one is available.
 */
export const chainFromAddress = (address: string): Chain | null => {
    if (isEvmAddress(address)) return 'ETHEREUM'
    if (isSolanaAddress(address)) return 'SOLANA'
    return null
}

/**
 * EVM addresses are compared lowercased everywhere. Mixing checksummed and lowercased forms
 * is how you end up with two rows for one wallet, or a listing nobody can find.
 * Solana addresses are case-sensitive base58 and must never be folded.
 */
export const normalizeAddress = (chain: Chain, address: string): string =>
    chain === 'ETHEREUM' ? address.toLowerCase() : address

// --- asset identity ---

/**
 * The canonical cross-chain key stored in Nft.assetId.
 *   Solana:   the mint address, as-is.
 *   Ethereum: "<contract>:<tokenId>", contract lowercased.
 */
export const makeAssetId = (
    chain: Chain,
    parts: { mintAddress?: string; contractAddress?: string; tokenId?: string | number | bigint }
): string => {
    if (chain === 'SOLANA') {
        const mint = parts.mintAddress?.trim()
        if (!mint) throw new Error('SOLANA assetId requires mintAddress')
        return mint
    }
    const contract = parts.contractAddress?.trim().toLowerCase()
    if (!contract) throw new Error('ETHEREUM assetId requires contractAddress')
    if (parts.tokenId === undefined || parts.tokenId === null || parts.tokenId === '') {
        throw new Error('ETHEREUM assetId requires tokenId')
    }
    return `${contract}:${String(parts.tokenId)}`
}

export type ParsedAssetId =
    | { chain: 'SOLANA'; mintAddress: string }
    | { chain: 'ETHEREUM'; contractAddress: string; tokenId: string }

/** Inverse of makeAssetId. Returns null rather than throwing, so route handlers can 400. */
export const parseAssetId = (assetId: string): ParsedAssetId | null => {
    const s = assetId.trim()
    if (!s) return null

    const colon = s.indexOf(':')
    if (colon === -1) {
        return isSolanaAddress(s) ? { chain: 'SOLANA', mintAddress: s } : null
    }

    const contractAddress = s.slice(0, colon).toLowerCase()
    const tokenId = s.slice(colon + 1)
    if (!isEvmAddress(contractAddress)) return null
    // Token ids are uint256; keep them as decimal strings so nothing overflows a JS number.
    if (!/^\d+$/.test(tokenId)) return null
    return { chain: 'ETHEREUM', contractAddress, tokenId }
}

// --- amounts ---

/**
 * Smallest-unit string to a decimal string, without going through a float. Prices are money;
 * 0.1 ETH must not become 0.09999999999999999 on the way to the database.
 */
export const fromBaseUnits = (amount: bigint | string, chain: Chain): string => {
    const decimals = CHAIN_CONFIG[chain].decimals
    const v = typeof amount === 'bigint' ? amount : BigInt(amount)
    const neg = v < 0n
    const abs = neg ? -v : v
    const s = abs.toString().padStart(decimals + 1, '0')
    const whole = s.slice(0, -decimals)
    const frac = s.slice(-decimals).replace(/0+$/, '')
    return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`
}

/** Decimal string to smallest units. Extra fractional digits are rejected, never rounded. */
export const toBaseUnits = (amount: string, chain: Chain): bigint => {
    const decimals = CHAIN_CONFIG[chain].decimals
    const s = amount.trim()
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`not a decimal amount: ${amount}`)
    const neg = s.startsWith('-')
    const [whole, frac = ''] = (neg ? s.slice(1) : s).split('.')
    if (frac.length > decimals) {
        throw new Error(`${amount} has more than ${decimals} decimals for ${chain}`)
    }
    const v = BigInt(whole + frac.padEnd(decimals, '0'))
    return neg ? -v : v
}

// --- rpc ---

/** Solana RPC, falling back to public devnet like every other call site in the worker. */
export const solanaRpc = (env: CloudflareBindings): string =>
    env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'

/**
 * Base Sepolia RPC. Defaults to publicnode, not sepolia.base.org: the official endpoint
 * serves stale reads immediately after a write, which silently corrupts read-after-write
 * flows like "mint, then look up the token id".
 */
export const evmRpc = (env: CloudflareBindings): string =>
    env.BASE_SEPOLIA_RPC_URL || 'https://base-sepolia-rpc.publicnode.com'

export const rpcFor = (env: CloudflareBindings, chain: Chain): string =>
    chain === 'ETHEREUM' ? evmRpc(env) : solanaRpc(env)
