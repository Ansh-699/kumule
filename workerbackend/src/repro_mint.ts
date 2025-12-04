
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplCore, createV1 } from '@metaplex-foundation/mpl-core'
import { generateSigner, publicKey } from '@metaplex-foundation/umi'

const run = async () => {
    try {
        console.log('Starting reproduction script...');
        // Simulate missing RPC URL
        const rpcUrl = undefined;
        // const rpcUrl = 'https://api.devnet.solana.com'; // Uncomment to test with valid URL

        console.log('Creating Umi with rpcUrl:', rpcUrl);
        const umi = createUmi(rpcUrl as any).use(mplCore());

        const owner = "Ag3m15Y3f3W3g3m15Y3f3W3g3m15Y3f3W3g3m15Y3f3W"; // Dummy address
        const ownerKey = publicKey(owner);
        const asset = generateSigner(umi);

        const userSigner = {
            publicKey: ownerKey,
            signMessage: async (msg: Uint8Array) => msg,
            signTransaction: async (tx: any) => tx,
            signAllTransactions: async (txs: any[]) => txs,
        };

        const createParams: any = {
            asset,
            name: "Test NFT",
            uri: "https://example.com/metadata.json",
            owner: ownerKey,
            authority: userSigner,
            payer: userSigner,
        };

        console.log('Building transaction...');
        const builder = createV1(umi, createParams);

        const builderWithBlockhash = await builder
            .setFeePayer(userSigner)
            .setLatestBlockhash(umi);

        console.log('Building final transaction...');
        const tx = await builderWithBlockhash.build(umi);

        console.log('Success!');
    } catch (error) {
        console.error('Caught error:', error);
    }
};

run();
