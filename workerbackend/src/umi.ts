import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplCore } from '@metaplex-foundation/mpl-core'

export const getUmi = (rpcUrl: string) => {
    return createUmi(rpcUrl)
        .use(mplCore())
}

