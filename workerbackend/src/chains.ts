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
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/**
 * How many bytes a base58 string decodes to. Only the length is needed, never the value.
 *
 * Quadratic in the input, which for a 44-character address is nothing.
 */
const base58ByteLength = (s: string): number => {
    const bytes: number[] = []
    for (const ch of s) {
        let carry = BASE58.indexOf(ch)
        if (carry < 0) return -1
        for (let i = 0; i < bytes.length; i++) {
            carry += bytes[i] * 58
            bytes[i] = carry & 0xff
            carry >>= 8
        }
        while (carry > 0) {
            bytes.push(carry & 0xff)
            carry >>= 8
        }
    }
    // A leading '1' is a leading zero byte, which the accumulation above never produces.
    let zeros = 0
    while (zeros < s.length && s[zeros] === '1') zeros++
    return zeros + bytes.length
}

export const isEvmAddress = (a: string): boolean => EVM_ADDRESS.test(a)

/**
 * A Solana address is base58 that decodes to exactly 32 bytes.
 *
 * The character window alone does not say that. '1' encodes a zero byte, so 43 of them is
 * well-formed base58 of an allowed length and 43 bytes long - not a public key. Strings like
 * that passed this check and then threw inside PublicKey()/publicKey(), turning a malformed
 * request into a 500, or (once confirmBurn started failing closed) a 503 telling the caller to
 * retry something that can never work.
 */
export const isSolanaAddress = (a: string): boolean =>
    SOLANA_ADDRESS.test(a) && base58ByteLength(a) === 32

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

/**
 * Decimal string to an integer scaled by `decimals`, without a float anywhere in the path.
 * Extra fractional digits are rejected, never rounded - silently dropping a digit off a
 * price loses someone money.
 *
 * Split out of toBaseUnits because chain decimals are not the only scale this repo needs:
 * an exchange rate is a decimal string too, and parsing it with `Number()` throws away the
 * precision before any BigInt can protect it.
 */
export const parseDecimal = (value: string, decimals: number): bigint => {
    const s = value.trim()
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`not a decimal amount: ${value}`)
    const neg = s.startsWith('-')
    const [whole, frac = ''] = (neg ? s.slice(1) : s).split('.')
    if (frac.length > decimals) {
        throw new Error(`${value} has more than ${decimals} decimals`)
    }
    const v = BigInt(whole + frac.padEnd(decimals, '0'))
    return neg ? -v : v
}

/** Decimal string to smallest units. Extra fractional digits are rejected, never rounded. */
export const toBaseUnits = (amount: string, chain: Chain): bigint => {
    const decimals = CHAIN_CONFIG[chain].decimals
    try {
        return parseDecimal(amount, decimals)
    } catch (e) {
        // The chain-specific message the existing callers and chains-check.ts expect.
        const msg = (e as Error).message
        if (msg.startsWith('not a decimal')) throw new Error(`not a decimal amount: ${amount}`)
        throw new Error(`${amount} has more than ${decimals} decimals for ${chain}`)
    }
}

/**
 * Divide two bigints, rounding up. Every fee this repo quotes rounds towards the platform:
 * rounding a fee down means Kumele silently pays the difference on every single mint.
 */
export const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b

// --- rpc ---

/**
 * Anything that names mainnet. This repo is devnet-only, top to bottom.
 *
 * Not hypothetical: a mainnet Helius URL was pasted into this configuration once already.
 * Had it been accepted, the mint would have tried to create assets on mainnet - paying with
 * real SOL from a wallet that holds none, so every order would fail - and every lookup of an
 * existing devnet asset would have come back empty, emptying the marketplace. A provider key
 * is usually valid on both networks, so the only thing separating the two is the hostname,
 * which makes it exactly the sort of mistake worth refusing in code rather than in a comment.
 */
const MAINNET_URL = /mainnet|api\.mainnet-beta\.solana\.com/i

/** Solana RPC, falling back to public devnet like every other call site in the worker. */
export const solanaRpc = (env: CloudflareBindings): string => solanaRpcChain(env)[0]

/**
 * Endpoints to try, in order, when a read fails.
 *
 * Not paranoia - measured. In one afternoon the configured provider returned
 * `429 max usage reached` (credits exhausted) and Solana Labs' own public endpoint returned
 * `403 Your IP or provider is blocked from this endpoint`, because it refuses Cloudflare
 * egress. Both of the obvious choices, both dead, and a paid mint sat unfulfilled behind
 * them. Every keyless endpoint rate-limits, so the answer is several rather than a better one.
 */
export const SOLANA_RPC_FALLBACKS = [
    'https://solana-devnet.api.onfinality.io/public',
    'https://api.devnet.solana.com',
] as const

/**
 * The configured endpoint first, then the fallbacks, with no duplicates and no mainnet.
 *
 * A mainnet endpoint is dropped rather than used, loudly. Silently honouring it would point
 * a devnet-only deployment at real money.
 */
export const solanaRpcChain = (env: CloudflareBindings): string[] => {
    const configured = env.SOLANA_RPC_URL
    if (configured && MAINNET_URL.test(configured)) {
        console.error(
            'SOLANA_RPC_URL names mainnet and is being ignored: this deployment is devnet-only. ' +
            'The same provider key normally works on the devnet host - use that instead.'
        )
    }
    const chain = configured ? [configured, ...SOLANA_RPC_FALLBACKS] : [...SOLANA_RPC_FALLBACKS]
    return [...new Set(chain)].filter((u) => !MAINNET_URL.test(u))
}

/**
 * Base Sepolia RPC. Defaults to publicnode, not sepolia.base.org: the official endpoint
 * serves stale reads immediately after a write, which silently corrupts read-after-write
 * flows like "mint, then look up the token id".
 */
export const evmRpc = (env: CloudflareBindings): string =>
    env.BASE_SEPOLIA_RPC_URL || 'https://base-sepolia-rpc.publicnode.com'

export const rpcFor = (env: CloudflareBindings, chain: Chain): string =>
    chain === 'ETHEREUM' ? evmRpc(env) : solanaRpc(env)
