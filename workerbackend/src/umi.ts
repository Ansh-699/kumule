import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplCore } from '@metaplex-foundation/mpl-core'
import { setComputeUnitPrice, setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox'
import type { TransactionBuilder } from '@metaplex-foundation/umi'

export const getUmi = (rpcUrl: string) => {
    if (!rpcUrl) {
        throw new Error('RPC URL is required to create Umi instance');
    }
    // 'confirmed', not the default 'finalized'. Reads here follow a transaction the caller has
    // already watched confirm, and finalization trails that by roughly fifteen seconds - long
    // enough that a just-purchased asset still reported its previous owner.
    return createUmi(rpcUrl, 'confirmed')
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

