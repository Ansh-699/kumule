import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplCore } from '@metaplex-foundation/mpl-core'
import { setComputeUnitPrice, setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox'
import type { TransactionBuilder } from '@metaplex-foundation/umi'

export const getUmi = (rpcUrl: string) => {
    if (!rpcUrl) {
        throw new Error('RPC URL is required to create Umi instance');
    }
    return createUmi(rpcUrl)
        .use(mplCore())
}

// Helper to add priority fees to a transaction builder
export const withPriorityFees = <T extends TransactionBuilder>(
    umi: ReturnType<typeof createUmi>,
    builder: T, 
    microLamports: number = 50000, 
    units: number = 200000
): T => {
    return builder
        .prepend(setComputeUnitLimit(umi, { units }))
        .prepend(setComputeUnitPrice(umi, { microLamports })) as T
}

