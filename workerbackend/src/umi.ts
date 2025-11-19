import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { keypairIdentity } from '@metaplex-foundation/umi'
import { mplCore } from '@metaplex-foundation/mpl-core'
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys'

export const getUmi = (rpcUrl: string = 'https://devnet.helius-rpc.com/?api-key=0d4faf3d-ecf9-4bfe-8073-f1bf28cad777') => {
    return createUmi(rpcUrl)
        .use(mplCore())
}

