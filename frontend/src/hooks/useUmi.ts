import { useMemo } from 'react';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { useWallet } from '@solana/wallet-adapter-react';

export const useUmi = () => {
    const wallet = useWallet();

    const umi = useMemo(() => {
        const u = createUmi('https://api.devnet.solana.com')
            .use(mplCore())
            .use(irysUploader());

        if (wallet.publicKey) {
            u.use(walletAdapterIdentity(wallet));
        }

        return u;
    }, [wallet]);

    return umi;
};
