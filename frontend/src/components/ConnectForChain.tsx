import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { useConnect, useConnectors } from 'wagmi'
import { Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ChainMark } from './ChainBadge'
import { CHAIN_UI } from '@/lib/chain-ui'
import type { Chain } from '@/lib/api'

/**
 * Connect the wallet a specific action needs, in place.
 *
 * The detail page used to print "Connect a Ethereum wallet" as dead text next to a disabled
 * button. Anyone browsing with only a Solana wallet hit that on every Base listing and read the
 * whole marketplace as broken. This offers the right connector where the blocked action is.
 *
 * Coinbase is named rather than shown as a generic "connect", because its smart wallet is a
 * passkey login with no extension to install - the shortest route to a funded Base wallet.
 */
export const ConnectForChain = ({ chain, action }: { chain: Chain; action: string }) => {
    const ui = CHAIN_UI[chain]
    const { setVisible } = useWalletModal()
    const solana = useWallet()
    const { connect, isPending } = useConnect()
    const connectors = useConnectors()

    if (chain === 'SOLANA') {
        return (
            <div className="rounded-xl bg-white/[0.03] p-4">
                <p className="text-sm text-white/60">
                    Connect a Solana wallet to {action}.
                </p>
                <button
                    onClick={() => setVisible(true)}
                    disabled={solana.connecting}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:opacity-60"
                >
                    <ChainMark chain="SOLANA" className="h-4 w-4" />
                    {solana.connecting ? 'Connecting…' : 'Connect Phantom or Solflare'}
                </button>
                <p className="mt-2 text-[11px] text-white/35">{ui.network} — no real funds involved.</p>
            </div>
        )
    }

    // Coinbase first if present, since it needs no extension.
    const coinbase = connectors.find((x) => x.id === 'coinbaseWalletSDK' || /coinbase/i.test(x.name))
    const injected = connectors.find((x) => x.id === 'injected')

    return (
        <div className="rounded-xl bg-white/[0.03] p-4">
            <p className="text-sm text-white/60">Connect an Ethereum wallet to {action}.</p>

            <div className="mt-3 space-y-2">
                {coinbase && (
                    <button
                        onClick={() => connect({ connector: coinbase })}
                        disabled={isPending}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0052FF] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0047e1] disabled:opacity-60"
                    >
                        <Wallet className="h-4 w-4" />
                        {isPending ? 'Connecting…' : 'Continue with Coinbase'}
                    </button>
                )}
                {injected && (
                    <button
                        onClick={() => connect({ connector: injected })}
                        disabled={isPending}
                        className={cn(
                            'flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors disabled:opacity-60',
                            'border border-white/10 text-white/80 hover:bg-white/5'
                        )}
                    >
                        <ChainMark chain="ETHEREUM" className="h-4 w-4" />
                        Browser wallet (MetaMask, Rabby)
                    </button>
                )}
            </div>

            <p className="mt-2 text-[11px] text-white/35">
                {ui.network} — testnet only. Coinbase Smart Wallet signs in with a passkey, so there
                is nothing to install.
            </p>
        </div>
    )
}
