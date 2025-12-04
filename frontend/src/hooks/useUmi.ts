import { useMemo } from 'react';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { useWallet } from '@solana/wallet-adapter-react';

export const useUmi = () => {
    const wallet = useWallet();

    const umi = useMemo(() => {
        const rpcUrl = import.meta.env.VITE_SOLANA_RPC_URL || 'https://devnet.helius-rpc.com/?api-key=0d4faf3d-ecf9-4bfe-8073-405021570776'; // Using a public/demo key or fallback to standard if needed
        const u = createUmi(rpcUrl)
            .use(mplCore())
            .use(irysUploader({
                address: 'https://devnet.irys.xyz',
                providerUrl: rpcUrl
            }));

        if (wallet.publicKey) {
            u.use(walletAdapterIdentity(wallet));
        }

        return u;
    }, [wallet]);

    return umi;
};
