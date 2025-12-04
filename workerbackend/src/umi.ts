import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplCore } from '@metaplex-foundation/mpl-core'

export const getUmi = (rpcUrl: string) => {
    if (!rpcUrl) {
        throw new Error('RPC URL is required to create Umi instance');
    }
    return createUmi(rpcUrl)
        .use(mplCore())
}

