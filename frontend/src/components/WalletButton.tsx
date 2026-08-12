import { useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { ChevronDown, LogOut, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ChainMark } from './ChainBadge'
import { CHAIN_UI, shortAddress } from '@/lib/chain-ui'

/**
 * Dual-chain connect.
 *
 * A multi-chain marketplace cannot have one "connect wallet" button: Solana and EVM are separate
 * wallet stacks, and a user may want either or both. So each chain gets its own row, and the
 * trigger reports how many are connected rather than pretending there is a single session.
 */

const Row = ({
    chain, address, onConnect, onDisconnect, connecting,
}: {
    chain: 'SOLANA' | 'ETHEREUM'
    address: string | null
    onConnect: () => void
    onDisconnect: () => void
    connecting?: boolean
}) => {
    const ui = CHAIN_UI[chain]
    const [copied, setCopied] = useState(false)

    const copy = async () => {
        if (!address) return
        await navigator.clipboard.writeText(address)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }

    return (
        <div className="flex items-center gap-3 px-3 py-2.5">
            <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', ui.badge)}>
                <ChainMark chain={chain} className="h-4 w-4" />
            </span>

            <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-white">{ui.label}</div>
                <div className="truncate text-[11px] text-white/45">
                    {address ? shortAddress(address, 6, 6) : ui.network}
                </div>
            </div>

            {address ? (
                <div className="flex shrink-0 items-center gap-1">
                    <button
                        onClick={copy}
                        aria-label={`Copy ${ui.label} address`}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-white/50 hover:bg-white/5 hover:text-white"
                    >
                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    <button
                        onClick={onDisconnect}
                        aria-label={`Disconnect ${ui.label}`}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-white/50 hover:bg-white/5 hover:text-red-300"
                    >
                        <LogOut className="h-3.5 w-3.5" />
                    </button>
                </div>
            ) : (
                <button
                    onClick={onConnect}
                    disabled={connecting}
                    className="shrink-0 rounded-lg bg-indigo-500 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-400 disabled:opacity-60"
                >
                    {connecting ? '…' : 'Connect'}
                </button>
            )}
        </div>
    )
}

export const WalletButton = () => {
    const [open, setOpen] = useState(false)

    const solana = useWallet()
    const { setVisible } = useWalletModal()
    const evm = useAccount()
    const { connect, connectors, isPending } = useConnect()
    const { disconnect: disconnectEvm } = useDisconnect()

    const solAddress = solana.publicKey?.toBase58() ?? null
    const evmAddress = evm.address ?? null
    const connectedCount = [solAddress, evmAddress].filter(Boolean).length

    const label =
        connectedCount === 0
            ? 'Connect Wallet'
            : connectedCount === 2
                ? '2 wallets'
                : shortAddress(solAddress ?? evmAddress, 4, 4)

    return (
        <div className="relative">
            <button
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className={cn(
                    'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors',
                    connectedCount > 0
                        ? 'border border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]'
                        : 'bg-indigo-500 text-white hover:bg-indigo-400'
                )}
            >
                {connectedCount > 0 && (
                    <span className="flex items-center -space-x-1">
                        {solAddress && <ChainMark chain="SOLANA" className="h-4 w-4 text-[#14F195]" />}
                        {evmAddress && <ChainMark chain="ETHEREUM" className="h-4 w-4 text-[#A6B1FF]" />}
                    </span>
                )}
                {label}
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
            </button>

            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
                    <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-white/10 bg-[#0e1018] shadow-2xl">
                        <div className="border-b border-white/[0.06] px-3 py-2">
                            <p className="text-[11px] uppercase tracking-wider text-white/40">Wallets</p>
                        </div>
                        <div className="divide-y divide-white/[0.05]">
                            <Row
                                chain="SOLANA"
                                address={solAddress}
                                onConnect={() => setVisible(true)}
                                onDisconnect={() => solana.disconnect()}
                                connecting={solana.connecting}
                            />
                            <Row
                                chain="ETHEREUM"
                                address={evmAddress}
                                onConnect={() => {
                                    const connector = connectors[0]
                                    if (connector) connect({ connector })
                                }}
                                onDisconnect={() => disconnectEvm()}
                                connecting={isPending}
                            />
                        </div>
                        <p className="border-t border-white/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-white/35">
                            Connect both to trade across chains. Solana runs on devnet and Ethereum on
                            Base Sepolia, so no real funds are involved.
                        </p>
                    </div>
                </>
            )}
        </div>
    )
}
