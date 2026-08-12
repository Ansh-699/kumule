import { type ReactNode, useMemo } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { config } from '@/wagmi'
import '@solana/wallet-adapter-react-ui/styles.css'

/**
 * Both chains' wallet stacks side by side, so a user can hold a Solana wallet and an EVM wallet
 * connected at once. The backend keys wallets on (chain, address) for exactly this reason.
 */

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // Chain and index data goes stale quickly; a minute is long enough to stop refetch
            // storms while browsing and short enough that a new mint appears without a reload.
            staleTime: 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
})

const SOLANA_RPC =
    (import.meta.env.VITE_SOLANA_RPC as string | undefined) || 'https://api.devnet.solana.com'

export const Providers = ({ children }: { children: ReactNode }) => {
    // Real wallets. The previous setup shipped UnsafeBurnerWalletAdapter, which generates a
    // throwaway keypair in the browser - fine for a demo, useless for owning an asset.
    const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], [])

    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <ConnectionProvider endpoint={SOLANA_RPC}>
                    <WalletProvider wallets={wallets} autoConnect>
                        <WalletModalProvider>{children}</WalletModalProvider>
                    </WalletProvider>
                </ConnectionProvider>
            </QueryClientProvider>
        </WagmiProvider>
    )
}
