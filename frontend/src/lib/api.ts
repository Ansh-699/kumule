// Typed client for the Kumule v2 API.
//
// Money arrives as decimal strings and stays that way. Nothing here calls Number() on a price:
// formatting for display is a string operation, and any arithmetic uses BigInt on base units.

export type Chain = 'SOLANA' | 'ETHEREUM'
export type Category =
    | 'ART' | 'PFP' | 'GAMING' | 'PHOTOGRAPHY' | 'MUSIC' | 'UTILITY' | 'VIRTUAL_WORLDS' | 'OTHER'
export type SortKey = 'recent' | 'oldest' | 'most_liked' | 'name'
export type ListingStatus = 'ACTIVE' | 'SOLD' | 'CANCELLED'

export const API_BASE =
    (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ||
    'https://kumele-backend.ansht.workers.dev'

export class ApiError extends Error {
    // Written out rather than using constructor parameter properties: tsconfig sets
    // erasableSyntaxOnly, which rejects syntax that emits runtime code from a type position.
    readonly status: number
    readonly details?: string

    constructor(status: number, message: string, details?: string) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.details = details
    }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    let res: Response
    try {
        res = await fetch(`${API_BASE}${path}`, {
            ...init,
            headers: {
                ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
                ...init?.headers,
            },
        })
    } catch (e) {
        // fetch rejects with a bare TypeError for anything network-level, which renders as the
        // useless "Failed to fetch". In this app the usual cause is a browser shield or content
        // blocker refusing the call: the UI and API sit on different subdomains, and some
        // blockers treat that as cross-site. Say so rather than leaving the user guessing.
        throw new ApiError(
            0,
            'Could not reach the API. A browser shield, ad blocker or privacy extension is the ' +
            'usual cause, since the app and the API are on different subdomains.',
            `${API_BASE}${path}: ${(e as Error)?.message ?? String(e)}`
        )
    }

    const text = await res.text()
    let body: any = null
    try {
        body = text ? JSON.parse(text) : null
    } catch {
        // A non-JSON body from an error page is still worth surfacing verbatim.
        if (!res.ok) throw new ApiError(res.status, text.slice(0, 200) || res.statusText)
    }

    if (!res.ok) {
        throw new ApiError(res.status, body?.error ?? res.statusText, body?.details)
    }
    return body as T
}

const qs = (params: Record<string, unknown>): string => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '' || v === false) continue
        sp.set(k, String(v))
    }
    const s = sp.toString()
    return s ? `?${s}` : ''
}

// ---------------------------------------------------------------- types

export type NftListing = {
    id: string
    price: string
    currency: 'SOL' | 'ETH'
    sellerAddress: string
    status: ListingStatus
}

export type Nft = {
    id: string
    assetId: string
    chain: Chain
    chainId: number | null
    chainLabel: string
    currency: 'SOL' | 'ETH'
    contractAddress: string | null
    tokenId: string | null
    mintAddress: string | null
    name: string
    description: string | null
    imageUrl: string | null
    metadataUri: string | null
    animationUrl: string | null
    category: Category
    attributes: unknown
    ownerAddress: string
    creatorAddress: string | null
    likeCount: number
    mintedAt: string
    collection: {
        id: string
        slug: string
        name: string
        imageUrl: string | null
        verified: boolean
    } | null
    listing: NftListing | null
    explorerUrl: string | null
}

export type Paged<T> = {
    data: T[]
    count: number
    total: number
    limit: number
    offset: number
    hasMore: boolean
}

export type Collection = {
    id: string
    slug: string
    chain: Chain
    chainLabel: string
    currency: 'SOL' | 'ETH'
    name: string
    description: string | null
    imageUrl: string | null
    bannerUrl: string | null
    category: Category
    verified: boolean
    itemCount: number
    floorPrice: string | null
    volume: string
}

export type Stats = {
    totals: { nfts: number; collectors: number; activeListings: number }
    windowDays: number
    chains: Record<Chain, { label: string; nfts: number; volume: string; currency: string }>
    sales: number
}

export type Medal = {
    id: string
    tier: 'GOLD' | 'SILVER' | 'BRONZE'
    chain: Chain
    name: string
    description: string | null
    imageUrl: string | null
    requiredPoints: number
    supply: number
    claimedCount: number
    remaining: number
    minted: boolean
    mintTxHash: string | null
    eligible: boolean
    claimed: boolean
    claimable: boolean
    pointsNeeded: number
    reason: string | null
}

export type EventSummary = {
    id: string
    slug: string
    name: string
    description: string | null
    imageUrl: string | null
    status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
    startsAt: string | null
    endsAt: string | null
    participants: number
    claims: number
    medals: Medal[]
}

export type EventDetail = EventSummary & {
    you: { joined: boolean; points: number; tasksCompleted: number; claimedMedalIds: string[] }
}

export type NftFilters = {
    chain?: Chain
    category?: Category
    owner?: string
    collection?: string
    minPrice?: string
    maxPrice?: string
    listedOnly?: boolean
    search?: string
    sort?: SortKey
    limit?: number
    offset?: number
}

// ---------------------------------------------------------------- marketplace

export const api = {
    health: () => request<{ status: string; version: string }>('/health'),

    chains: () =>
        request<{
            data: Array<{
                chain: Chain
                label: string
                currency: string
                decimals: number
                chainId?: number
                network?: string
                cluster?: string
                contracts?: { nft: string; market: string }
            }>
        }>('/api/chains'),

    nfts: (f: NftFilters = {}) => request<Paged<Nft>>(`/api/nfts${qs(f)}`),

    nft: (assetId: string) =>
        request<
            Nft & {
                listingHistory: Array<{
                    id: string
                    price: string
                    currency: string
                    status: ListingStatus
                    sellerAddress: string
                    createdAt: string
                }>
                sales: Array<{
                    price: string
                    currency: string
                    buyerAddress: string
                    sellerAddress: string
                    txHash: string
                    explorerUrl: string
                    soldAt: string
                }>
                music: {
                    trackId: string
                    title: string
                    audioUrl: string
                    durationSec: number | null
                    isPreviewable: boolean
                    previewSeconds: number
                    album: { id: string; name: string; artist: string }
                } | null
            }
        >(`/api/nfts/${encodeURIComponent(assetId)}`),

    toggleLike: (assetId: string, walletAddress: string) =>
        request<{ success: boolean; liked: boolean; likeCount: number }>(
            `/api/nfts/${encodeURIComponent(assetId)}/like`,
            { method: 'POST', body: JSON.stringify({ walletAddress }) }
        ),

    likeState: (assetId: string, wallet: string) =>
        request<{ liked: boolean }>(
            `/api/nfts/${encodeURIComponent(assetId)}/liked?wallet=${encodeURIComponent(wallet)}`
        ),

    listings: (p: { chain?: Chain; limit?: number; offset?: number } = {}) =>
        request<Paged<{
            listingId: string
            chain: Chain
            chainLabel: string
            price: string
            currency: string
            sellerAddress: string
            escrowPda: string | null
            createdAt: string
            nft: Nft
        }>>(`/api/listings${qs(p)}`),

    collections: (p: { chain?: Chain; category?: Category; verified?: boolean; limit?: number } = {}) =>
        request<{ data: Collection[]; count: number }>(`/api/collections${qs(p)}`),

    stats: (days?: number) => request<Stats>(`/api/stats${qs({ days })}`),

    // ---------------------------------------------------------------- solana

    solanaOwner: (owner: string) =>
        request<Array<{ publicKey: string; name: string; uri: string }>>(
            `/api/solana/owner${qs({ owner })}`
        ),

    solanaMint: (body: { uri: string; name: string; owner: string; collection?: string; feeTxSignature?: string }) =>
        request<{ transaction: string; mint: string }>('/api/solana/mint', {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    solanaList: (body: { assetId: string; seller: string; price: string }) =>
        request<{ transaction: string; escrow: string }>('/api/solana/list', {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    solanaBuy: (body: { assetId: string; buyer: string; seller: string }) =>
        request<{ transaction: string }>('/api/solana/buy', {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    solanaCancel: (body: { assetId: string; seller: string }) =>
        request<{ transaction: string }>('/api/solana/cancel', {
            method: 'POST',
            body: JSON.stringify(body),
        }),

    solanaBurn: (body: { assetId: string; owner: string }) =>
        request<{ transaction: string; assetId: string; name: string; warning: string }>(
            '/api/solana/burn',
            { method: 'POST', body: JSON.stringify(body) }
        ),

    solanaBurnConfirm: (body: { assetId: string; signature: string }) =>
        request<{ success: boolean; burned: string; name: string; txHash: string; explorerUrl: string }>(
            '/api/solana/burn/confirm',
            { method: 'POST', body: JSON.stringify(body) }
        ),

    solanaVerify: (signature: string) =>
        request<{ verified: boolean }>(`/api/solana/verify/${signature}`),

    // ---------------------------------------------------------------- evm

    evmContracts: () =>
        request<{ chainId: number; network: string; nft: string; market: string }>('/api/evm/contracts'),

    evmListings: (p: { activeOnly?: boolean; limit?: number } = {}) =>
        request<{
            data: Array<{
                listingId: string
                seller: string
                contractAddress: string
                tokenId: string
                assetId: string
                price: string
                priceWei: string
                active: boolean
            }>
            count: number
        }>(`/api/evm/listings${qs(p)}`),

    evmVerify: (txHash: string) => request<{ verified: boolean }>(`/api/evm/verify/${txHash}`),

    // ---------------------------------------------------------------- events

    events: () => request<{ data: EventSummary[]; count: number }>('/api/events'),

    event: (id: string, wallet?: string) =>
        request<EventDetail>(`/api/events/${encodeURIComponent(id)}${qs({ wallet })}`),

    joinEvent: (id: string, walletAddress: string) =>
        request<{ success: boolean; points: number }>(`/api/events/${encodeURIComponent(id)}/join`, {
            method: 'POST',
            body: JSON.stringify({ walletAddress }),
        }),

    claimMedal: (eventId: string, medalId: string, walletAddress: string) =>
        request<{ success: boolean; tier: string; assetId: string; txHash: string; explorerUrl: string }>(
            `/api/events/${encodeURIComponent(eventId)}/medals/${medalId}/claim`,
            { method: 'POST', body: JSON.stringify({ walletAddress }) }
        ),

    leaderboard: (id: string) =>
        request<{
            data: Array<{ rank: number; walletAddress: string; points: number; tasksCompleted: number }>
        }>(`/api/events/${encodeURIComponent(id)}/leaderboard`),

    // ---------------------------------------------------------------- uploads

    uploadImage: async (file: File): Promise<{ url: string }> => {
        const fd = new FormData()
        fd.append('image', file)
        const res = await fetch(`${API_BASE}/api/upload/image`, { method: 'POST', body: fd })
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new ApiError(res.status, body?.error ?? 'Upload failed')
        return body
    },

    uploadMetadata: (metadata: Record<string, unknown>) =>
        request<{ url: string }>('/api/upload/metadata', {
            method: 'POST',
            body: JSON.stringify({ metadata }),
        }),
}

// ---------------------------------------------------------------- admin

/** Admin calls carry the key in a header. It is never put in a query param. */
export const adminApi = (key: string) => {
    const withKey = <T>(path: string, init?: RequestInit) =>
        request<T>(path, { ...init, headers: { 'X-Admin-API-Key': key, ...init?.headers } })

    return {
        overview: () =>
            withKey<{
                totals: Record<string, number>
                chains: Record<Chain, {
                    label: string; currency: string; nfts: number; wallets: number
                    activeListings: number; listedValue: string; sales: number; volume: string
                }>
                categories: Array<{ category: string; count: number }>
                recentSales: Array<{
                    chain: Chain; nftName: string; assetId: string; imageUrl: string | null
                    price: string; currency: string; buyerAddress: string; sellerAddress: string
                    txHash: string; explorerUrl: string; soldAt: string
                }>
                recentTransactions: Array<{
                    id: string; chain: Chain; kind: string; status: string
                    walletAddress: string | null; amount: string | null; currency: string | null
                    txHash: string | null; explorerUrl: string | null; createdAt: string
                }>
            }>('/api/admin/overview'),

        users: (p: { limit?: number; offset?: number } = {}) =>
            withKey<Paged<{
                id: string
                handle: string | null
                createdAt: string
                wallets: Array<{ chain: Chain; address: string; isPrimary: boolean; explorerUrl: string }>
                counts: Record<string, number>
            }>>(`/api/admin/users${qs(p)}`),

        listings: (p: { chain?: Chain; status?: ListingStatus; limit?: number; offset?: number } = {}) =>
            withKey<Paged<{
                id: string; chain: Chain; status: ListingStatus; price: string; currency: string
                sellerAddress: string; escrowPda: string | null
                nft: { name: string; assetId: string; imageUrl: string | null; ownerAddress: string }
                createdAt: string
            }>>(`/api/admin/listings${qs(p)}`),

        transactions: (p: { chain?: Chain; kind?: string; status?: string; limit?: number; offset?: number } = {}) =>
            withKey<Paged<{
                id: string; chain: Chain; kind: string; status: string
                walletAddress: string | null; amount: string | null; currency: string | null
                txHash: string | null; explorerUrl: string | null; createdAt: string
            }>>(`/api/admin/transactions${qs(p)}`),

        brokenNfts: (p: { limit?: number; offset?: number } = {}) =>
            withKey<Paged<{
                assetId: string; chain: Chain; name: string; metadataUri: string | null
                imageUrl: string | null; hidden: boolean; ownerAddress: string; mintedAt: string
            }>>(`/api/admin/nfts/broken${qs(p)}`),

        setHidden: (assetId: string, hidden: boolean) =>
            withKey<{ success: boolean; hidden: boolean }>(
                `/api/admin/nfts/${encodeURIComponent(assetId)}/hide`,
                { method: 'POST', body: JSON.stringify({ hidden }) }
            ),

        createEvent: (body: Record<string, unknown>) =>
            withKey<{ success: boolean; event: EventSummary }>('/api/admin/events', {
                method: 'POST',
                body: JSON.stringify(body),
            }),

        deleteEvent: (id: string) =>
            withKey<{ success: boolean }>(`/api/admin/events/${id}`, { method: 'DELETE' }),

        grantPoints: (eventId: string, walletAddress: string, points: number, reason?: string) =>
            withKey<{ success: boolean; points: number }>(`/api/admin/events/${eventId}/points`, {
                method: 'POST',
                body: JSON.stringify({ walletAddress, points, reason }),
            }),

        mintMedals: (eventId: string) =>
            withKey<{
                success: boolean
                vault: string
                minted: Array<{ tier: string; assetId: string; txHash: string }>
                failed: Array<{ tier: string; error: string }>
            }>(`/api/admin/events/${eventId}/medals/mint`, { method: 'POST' }),

        claims: (eventId: string) =>
            withKey<{
                data: Array<{
                    id: string; tier: string; medalName: string; walletAddress: string
                    pointsAtClaim: number; txHash: string | null; explorerUrl: string | null
                    claimedAt: string
                }>
            }>(`/api/admin/events/${eventId}/claims`),
    }
}
