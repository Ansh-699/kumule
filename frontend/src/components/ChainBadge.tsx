import { cn } from '@/lib/utils'
import { CHAIN_UI } from '@/lib/chain-ui'
import type { Chain } from '@/lib/api'

/** Solana's mark. Inline SVG so a card never waits on a network request to show its chain. */
const SolanaMark = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M4.6 15.9a.9.9 0 0 1 .63-.26h14.1c.4 0 .6.48.32.76l-2.79 2.79a.9.9 0 0 1-.63.26H2.13c-.4 0-.6-.48-.32-.76L4.6 15.9Z" fill="currentColor" />
        <path d="M4.6 5.31a.9.9 0 0 1 .63-.26h14.1c.4 0 .6.48.32.76l-2.79 2.8a.9.9 0 0 1-.63.25H2.13c-.4 0-.6-.48-.32-.76L4.6 5.31Z" fill="currentColor" />
        <path d="M16.86 10.57a.9.9 0 0 0-.63-.26H2.13c-.4 0-.6.48-.32.76l2.79 2.8a.9.9 0 0 0 .63.25h14.1c.4 0 .6-.48.32-.76l-2.79-2.79Z" fill="currentColor" />
    </svg>
)

/** Ethereum's diamond. */
const EthereumMark = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M12 2 5.5 12.2 12 16l6.5-3.8L12 2Z" fill="currentColor" fillOpacity=".85" />
        <path d="M12 17.3 5.5 13.5 12 22l6.5-8.5-6.5 3.8Z" fill="currentColor" fillOpacity=".55" />
    </svg>
)

export const ChainMark = ({ chain, className }: { chain: Chain; className?: string }) =>
    chain === 'SOLANA' ? <SolanaMark className={className} /> : <EthereumMark className={className} />

type Props = {
    chain: Chain
    /** `icon` is the floating square on a card image; `pill` shows the chain name too. */
    variant?: 'icon' | 'pill'
    className?: string
}

/**
 * The chain a token lives on, shown on every card.
 *
 * Rendered from data the API returns rather than inferred client-side, and always carries an
 * accessible label - colour alone would leave the distinction invisible to a screen reader and
 * to anyone who cannot separate the two hues.
 */
export const ChainBadge = ({ chain, variant = 'icon', className }: Props) => {
    const ui = CHAIN_UI[chain]

    if (variant === 'pill') {
        return (
            <span
                className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium backdrop-blur-sm',
                    ui.badge,
                    className
                )}
            >
                <ChainMark chain={chain} className="h-3.5 w-3.5" />
                {ui.label}
            </span>
        )
    }

    return (
        <span
            className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-lg backdrop-blur-md',
                ui.badge,
                className
            )}
            title={ui.network}
        >
            <ChainMark chain={chain} className="h-4 w-4" />
            <span className="sr-only">{ui.label}</span>
        </span>
    )
}
