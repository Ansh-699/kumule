import { http, createConfig } from 'wagmi'
import { base } from 'wagmi/chains'
import { coinbaseWallet } from 'wagmi/connectors'

export const config = createConfig({
    chains: [base],
    connectors: [
        coinbaseWallet({ appName: 'NFT Marketplace' }),
    ],
    transports: {
        [base.id]: http(),
    },
})
