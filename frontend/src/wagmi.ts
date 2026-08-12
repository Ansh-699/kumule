import { http, createConfig } from 'wagmi'
import { baseSepolia } from 'wagmi/chains'
import { coinbaseWallet, injected } from 'wagmi/connectors'

/**
 * EVM config for Kumule.
 *
 * Base Sepolia, not Base mainnet. The previous config listed `base`, which would have pointed
 * every listing and purchase at real funds while the contracts only exist on the testnet.
 *
 * Coinbase Smart Wallet first: it is a passkey login with no extension to install, which is the
 * one genuinely useful thing Coinbase still offers here now that Commerce is gone. `injected`
 * follows so MetaMask and Rabby users are not shut out.
 *
 * The RPC default is publicnode rather than sepolia.base.org, which serves stale reads
 * immediately after a write - the read-after-write trap that broke the first deploy script.
 */
const RPC_URL =
    (import.meta.env.VITE_BASE_SEPOLIA_RPC as string | undefined) ||
    'https://base-sepolia-rpc.publicnode.com'

export const config = createConfig({
    chains: [baseSepolia],
    connectors: [
        coinbaseWallet({ appName: 'Kumule', preference: 'all' }),
        injected(),
    ],
    transports: {
        [baseSepolia.id]: http(RPC_URL),
    },
})

export const EVM_CHAIN_ID = baseSepolia.id

declare module 'wagmi' {
    interface Register {
        config: typeof config
    }
}
