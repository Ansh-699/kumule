// Chain presentation: the badge on every card, price formatting, address shortening.
//
// Kept separate from api.ts so display rules live in one place. The backend already tells us
// each asset's chain, so nothing here infers it.

import type { Chain } from './api'

export type ChainUi = {
    chain: Chain
    label: string
    currency: 'SOL' | 'ETH'
    /** Tailwind classes for the badge, tuned for the dark surface in the mockup. */
    badge: string
    accent: string
    /**
     * Complete class including the `hover:` prefix, never assembled at a call site.
     * Tailwind's scanner reads source files as plain text - a class built by interpolation
     * (`` `hover:${ui.glow}` ``) is invisible to it and gets purged from the production
     * bundle, so the effect worked in dev and silently vanished in the built CSS.
     */
    hoverGlow: string
    network: string
    explorerAddress: (a: string) => string
    explorerTx: (h: string) => string
}

export const CHAIN_UI: Record<Chain, ChainUi> = {
    SOLANA: {
        chain: 'SOLANA',
        label: 'Solana',
        currency: 'SOL',
        badge: 'bg-gradient-to-br from-[#14F195]/20 to-[#9945FF]/20 text-[#14F195] ring-1 ring-[#14F195]/30',
        accent: 'text-[#14F195]',
        hoverGlow: 'hover:shadow-[0_0_24px_-8px_rgba(20,241,149,0.45)]',
        network: 'Solana Devnet',
        explorerAddress: (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`,
        explorerTx: (h) => `https://explorer.solana.com/tx/${h}?cluster=devnet`,
    },
    ETHEREUM: {
        chain: 'ETHEREUM',
        label: 'Ethereum',
        currency: 'ETH',
        badge: 'bg-gradient-to-br from-[#8A92B2]/25 to-[#627EEA]/25 text-[#A6B1FF] ring-1 ring-[#627EEA]/40',
        accent: 'text-[#A6B1FF]',
        hoverGlow: 'hover:shadow-[0_0_24px_-8px_rgba(98,126,234,0.5)]',
        network: 'Base Sepolia',
        explorerAddress: (a) => `https://sepolia.basescan.org/address/${a}`,
        explorerTx: (h) => `https://sepolia.basescan.org/tx/${h}`,
    },
}

export const CATEGORIES = [
    { value: 'ART', label: 'Art', icon: 'Palette' },
    { value: 'PFP', label: 'PFPs', icon: 'Smile' },
    { value: 'GAMING', label: 'Gaming', icon: 'Gamepad2' },
    { value: 'PHOTOGRAPHY', label: 'Photography', icon: 'Camera' },
    { value: 'MUSIC', label: 'Music', icon: 'Music' },
    { value: 'UTILITY', label: 'Utility', icon: 'Wrench' },
    { value: 'VIRTUAL_WORLDS', label: 'Virtual Worlds', icon: 'Globe' },
    { value: 'OTHER', label: 'Other', icon: 'Boxes' },
] as const

export const SORT_OPTIONS = [
    { value: 'recent', label: 'Recently Added' },
    { value: 'oldest', label: 'Oldest First' },
    { value: 'most_liked', label: 'Most Favorited' },
    { value: 'name', label: 'Name A-Z' },
] as const

/**
 * Trim a decimal price for display without touching a float.
 *
 * Purely string work: split on the point, cut the fraction, drop trailing zeros. parseFloat
 * would round 0.000025 into something shorter but wrong, and these are prices.
 */
export const formatPrice = (value: string, maxFractionDigits = 4): string => {
    if (!value) return '0'
    const negative = value.startsWith('-')
    const abs = negative ? value.slice(1) : value
    const [whole, fraction = ''] = abs.split('.')

    let frac = fraction.slice(0, maxFractionDigits).replace(/0+$/, '')
    // A tiny non-zero amount must not render as "0" - show that something is there.
    if (!frac && fraction && /[1-9]/.test(fraction)) {
        const firstSignificant = fraction.search(/[1-9]/)
        frac = fraction.slice(0, firstSignificant + 1)
    }

    const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return `${negative ? '-' : ''}${groupedWhole}${frac ? `.${frac}` : ''}`
}

export const formatPriceWithCurrency = (value: string, currency: string): string =>
    `${formatPrice(value)} ${currency}`

/** Compact counts for stat tiles: 12400 -> 12.4K. Display only, never money. */
export const formatCount = (n: number): string => {
    if (n < 1_000) return String(n)
    if (n < 1_000_000) {
        const k = n / 1_000
        return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K`
    }
    const m = n / 1_000_000
    return `${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, '')}M`
}

/** Middle-truncate an address. EVM keeps 0x visible; Solana base58 has no prefix. */
export const shortAddress = (address: string | null | undefined, lead = 4, tail = 4): string => {
    if (!address) return '—'
    if (address.length <= lead + tail + 2) return address
    return `${address.slice(0, address.startsWith('0x') ? lead + 2 : lead)}…${address.slice(-tail)}`
}

export const relativeTime = (iso: string): string => {
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return ''
    const seconds = Math.round((Date.now() - then) / 1000)
    if (seconds < 60) return 'just now'
    const units: Array<[number, string]> = [
        [60, 'm'],
        [3_600, 'h'],
        [86_400, 'd'],
        [604_800, 'w'],
    ]
    for (let i = units.length - 1; i >= 0; i--) {
        const [size, suffix] = units[i]
        if (seconds >= size) return `${Math.floor(seconds / size)}${suffix} ago`
    }
    return 'just now'
}

export const TIER_UI = {
    GOLD: { label: 'Gold', ring: 'ring-amber-400/60', text: 'text-amber-300', bg: 'bg-amber-400/10' },
    SILVER: { label: 'Silver', ring: 'ring-slate-300/60', text: 'text-slate-200', bg: 'bg-slate-300/10' },
    BRONZE: { label: 'Bronze', ring: 'ring-orange-500/60', text: 'text-orange-300', bg: 'bg-orange-500/10' },
} as const
