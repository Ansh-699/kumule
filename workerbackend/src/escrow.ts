import { Context } from 'hono'
import { Buffer } from 'buffer'
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'
import { BN, Program, AnchorProvider } from '@coral-xyz/anchor'
import { createNoopSigner, publicKey as umiPublicKey, signerIdentity } from '@metaplex-foundation/umi'
import { getUmi } from './umi'
import { fetchAssetV1, getAssetV1GpaBuilder } from '@metaplex-foundation/mpl-core'


const ESCROW_PROGRAM_ID = new PublicKey('4WYfhmmEu1MoSMDQfiN2JEbQV28gSo6vhm9idEL7ArtG')
const ESCROW_SEED = Buffer.from('escrow')

function getEscrowPDA(asset: PublicKey, seller: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [ESCROW_SEED, asset.toBuffer(), seller.toBuffer()],
        ESCROW_PROGRAM_ID
    )
}


interface EscrowAccount {
    asset: PublicKey
    seller: PublicKey
    buyer: PublicKey | null
    price: bigint
    bump: number
    status: number // 0=Pending, 1=Deposited, 2=Completed, 3=Cancelled
}

function parseEscrowAccount(data: Buffer): EscrowAccount {

    let offset = 8

    const asset = new PublicKey(data.slice(offset, offset + 32))
    offset += 32

    const seller = new PublicKey(data.slice(offset, offset + 32))
    offset += 32


    const hasBuyer = data[offset] === 1
    offset += 1

    let buyer: PublicKey | null = null
    if (hasBuyer) {
        buyer = new PublicKey(data.slice(offset, offset + 32))
        offset += 32
    }

    const price = data.readBigUInt64LE(offset)
    offset += 8

    const bump = data[offset]
    offset += 1

    const status = data[offset]

    return { asset, seller, buyer, price, bump, status }
}

const IDL = {
    address: ESCROW_PROGRAM_ID.toBase58(),
    metadata: {
        name: 'nftmarketplace',
        version: '0.1.0',
        spec: '0.1.0',
    },
    instructions: [
        {
            name: 'create_escrow',
            discriminator: [253, 215, 165, 116, 36, 108, 68, 80],
            accounts: [
                { name: 'seller', writable: true, signer: true },
                { name: 'asset' },
                { name: 'escrow', writable: true, pda: { seeds: [{ kind: 'const', value: [101, 115, 99, 114, 111, 119] }, { kind: 'account', path: 'asset' }, { kind: 'account', path: 'seller' }] } },
                { name: 'system_program', address: '11111111111111111111111111111111' },
            ],
            args: [
                { name: 'price', type: 'u64' },
                { name: 'buyer', type: { option: 'pubkey' } },
            ],
        },
        {
            name: 'deposit_asset',
            discriminator: [107, 93, 89, 87, 226, 203, 154, 19],
            accounts: [
                { name: 'seller', writable: true, signer: true },
                { name: 'asset', writable: true },
                { name: 'escrow', writable: true },
                { name: 'system_program', address: '11111111111111111111111111111111' },
                { name: 'mpl_core_program', address: 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d' },
            ],
            args: [],
        },
        {
            name: 'buy_asset',
            discriminator: [197, 37, 177, 1, 180, 23, 175, 98],
            accounts: [
                { name: 'buyer', writable: true, signer: true },
                { name: 'asset', writable: true },
                { name: 'seller', writable: true },
                { name: 'escrow', writable: true },
                { name: 'system_program', address: '11111111111111111111111111111111' },
                { name: 'mpl_core_program', address: 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d' },
            ],
            args: [],
        },
        {
            name: 'cancel_escrow',
            discriminator: [156, 203, 54, 179, 38, 72, 33, 21],
            accounts: [
                { name: 'seller', writable: true, signer: true },
                { name: 'asset', writable: true },
                { name: 'escrow', writable: true },
                { name: 'system_program', address: '11111111111111111111111111111111' },
                { name: 'mpl_core_program', address: 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d' },
            ],
            args: [],
        },
        {
            name: 'close_escrow',
            discriminator: [139, 171, 94, 146, 191, 91, 144, 50],
            accounts: [
                { name: 'seller', writable: true, signer: true },
                { name: 'escrow', writable: true, pda: { seeds: [{ kind: 'const', value: [101, 115, 99, 114, 111, 119] }, { kind: 'account', path: 'asset' }, { kind: 'account', path: 'seller' }] } },
            ],
            args: [],
        },
    ],
}

export const getListings = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const connection = new Connection(c.env.SOLANA_RPC_URL)


        let accounts: any[] = []
        try {
            accounts = await connection.getProgramAccounts(ESCROW_PROGRAM_ID) as any[]
        } catch (e) {
            console.log('Program not deployed or no accounts found, returning empty list')
            return c.json({ listings: [] })
        }

        const umi = getUmi(c.env.SOLANA_RPC_URL)
        const listings = []

        for (const { pubkey, account } of accounts) {
            try {
                const escrowData = parseEscrowAccount(account.data)

                if (escrowData.status !== 1) {
                    continue
                }

                const asset = await fetchAssetV1(umi, umiPublicKey(escrowData.asset.toBase58()))

                listings.push({
                    escrow: pubkey.toBase58(),
                    asset: escrowData.asset.toBase58(),
                    seller: escrowData.seller.toBase58(),
                    price: Number(escrowData.price) / 1e9,
                    name: asset.name,
                    uri: asset.uri,
                })
            } catch (error) {
                console.error('Error processing escrow:', pubkey.toBase58(), error)
            }
        }

        return c.json({ listings })
    } catch (error) {
        console.error('Get listings error details:', error);
        if (error instanceof Error) {
            console.error('Stack:', error.stack);
        }
        return c.text(`Get listings failed: ${error}`, 500)
    }
}

export const listNft = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const body = await c.req.json()
        const { assetId, seller, price } = body

        if (!assetId || !seller || !price) {
            return c.text('Missing assetId, seller, or price', 400)
        }

        const assetPubkey = new PublicKey(assetId)
        const sellerPubkey = new PublicKey(seller)
        const priceNum = Number(price)

        if (isNaN(priceNum) || priceNum <= 0) {
            return c.text('Invalid price', 400)
        }

        const [escrowPDA] = getEscrowPDA(assetPubkey, sellerPubkey)
        const connection = new Connection(c.env.SOLANA_RPC_URL)

        const tx = new Transaction()

        const escrowAccountInfo = await connection.getAccountInfo(escrowPDA)

        if (escrowAccountInfo) {
            console.log('Escrow account exists, checking status...')
            try {
                const escrowData = parseEscrowAccount(escrowAccountInfo.data)
                console.log('Existing escrow status:', escrowData.status)


                if (escrowData.status === 1) {
                    return c.text('NFT is already listed', 400)
                }


                if (escrowData.status === 0 || escrowData.status === 2 || escrowData.status === 3) {
                    console.log('Closing existing escrow account to reset state...')
                    const closeEscrowIx = new TransactionInstruction({
                        programId: ESCROW_PROGRAM_ID,
                        keys: [
                            { pubkey: sellerPubkey, isSigner: true, isWritable: true },
                            { pubkey: escrowPDA, isSigner: false, isWritable: true },
                        ],
                        data: Buffer.from(IDL.instructions[4].discriminator),
                    })
                    tx.add(closeEscrowIx)
                }
            } catch (e) {
                console.error('Error parsing existing escrow account:', e)

                if (escrowAccountInfo.owner.equals(ESCROW_PROGRAM_ID)) {
                    console.log('Account owned by program but parse failed, attempting to close...')
                    const closeEscrowIx = new TransactionInstruction({
                        programId: ESCROW_PROGRAM_ID,
                        keys: [
                            { pubkey: sellerPubkey, isSigner: true, isWritable: true },
                            { pubkey: escrowPDA, isSigner: false, isWritable: true },
                        ],
                        data: Buffer.from(IDL.instructions[4].discriminator),
                    })
                    tx.add(closeEscrowIx)
                }
            }
        }

        const createEscrowIx = new TransactionInstruction({
            programId: ESCROW_PROGRAM_ID,
            keys: [
                { pubkey: sellerPubkey, isSigner: true, isWritable: true },
                { pubkey: assetPubkey, isSigner: false, isWritable: false },
                { pubkey: escrowPDA, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: Buffer.from([
                ...IDL.instructions[0].discriminator,
                ...new BN(priceNum * 1e9).toArray('le', 8),
                0,
            ]),
        })


        const umi = getUmi(c.env.SOLANA_RPC_URL)
        const asset = await fetchAssetV1(umi, umiPublicKey(assetId))

        const depositAssetKeys = [
            { pubkey: sellerPubkey, isSigner: true, isWritable: true },
            { pubkey: assetPubkey, isSigner: false, isWritable: true },
            { pubkey: escrowPDA, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'), isSigner: false, isWritable: false },
        ]


        if (asset.updateAuthority.type === 'Collection' && asset.updateAuthority.address) {
            depositAssetKeys.push({
                pubkey: new PublicKey(asset.updateAuthority.address.toString()),
                isSigner: false,
                isWritable: false
            })
        }

        if (asset.pluginHeader) {
            depositAssetKeys.push({
                pubkey: new PublicKey(asset.pluginHeader.key),
                isSigner: false,
                isWritable: true
            })
        }

        const depositAssetIx = new TransactionInstruction({
            programId: ESCROW_PROGRAM_ID,
            keys: depositAssetKeys,
            data: Buffer.from(IDL.instructions[1].discriminator),
        })

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()

        tx.recentBlockhash = blockhash
        tx.lastValidBlockHeight = lastValidBlockHeight
        tx.feePayer = sellerPubkey
        tx.add(createEscrowIx, depositAssetIx)

        const serializedTx = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        const base64Tx = Buffer.from(serializedTx).toString('base64')

        return c.json({ transaction: base64Tx, escrow: escrowPDA.toBase58() })
    } catch (error) {
        console.error('List NFT error:', error)
        return c.text(`List NFT failed: ${error}`, 500)
    }
}

export const buyNft = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const body = await c.req.json()
        const { assetId, buyer, seller } = body

        if (!assetId || !buyer || !seller) {
            return c.text('Missing assetId, buyer, or seller', 400)
        }

        const assetPubkey = new PublicKey(assetId)
        const buyerPubkey = new PublicKey(buyer)
        const sellerPubkey = new PublicKey(seller)

        const [escrowPDA] = getEscrowPDA(assetPubkey, sellerPubkey)

        const umi = getUmi(c.env.SOLANA_RPC_URL)
        const asset = await fetchAssetV1(umi, umiPublicKey(assetId))

        const buyAssetKeys = [
            { pubkey: buyerPubkey, isSigner: true, isWritable: true },
            { pubkey: assetPubkey, isSigner: false, isWritable: true },
            { pubkey: sellerPubkey, isSigner: false, isWritable: true },
            { pubkey: escrowPDA, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'), isSigner: false, isWritable: false },
        ]

        if (asset.updateAuthority.type === 'Collection' && asset.updateAuthority.address) {
            buyAssetKeys.push({
                pubkey: new PublicKey(asset.updateAuthority.address.toString()),
                isSigner: false,
                isWritable: false
            })
        }

        if (asset.pluginHeader) {
            buyAssetKeys.push({
                pubkey: new PublicKey(asset.pluginHeader.key),
                isSigner: false,
                isWritable: true
            })
        }

        const buyAssetIx = new TransactionInstruction({
            programId: ESCROW_PROGRAM_ID,
            keys: buyAssetKeys,
            data: Buffer.from(IDL.instructions[2].discriminator),
        })

        const connection = new Connection(c.env.SOLANA_RPC_URL)
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()

        const tx = new Transaction()
        tx.recentBlockhash = blockhash
        tx.lastValidBlockHeight = lastValidBlockHeight
        tx.feePayer = buyerPubkey
        tx.add(buyAssetIx)

        const serializedTx = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        const base64Tx = Buffer.from(serializedTx).toString('base64')

        return c.json({ transaction: base64Tx })
    } catch (error) {
        console.error('Buy NFT error:', error)
        return c.text(`Buy NFT failed: ${error}`, 500)
    }
}

export const cancelListing = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const body = await c.req.json()
        const { assetId, seller } = body

        if (!assetId || !seller) {
            return c.text('Missing assetId or seller', 400)
        }

        const assetPubkey = new PublicKey(assetId)
        const sellerPubkey = new PublicKey(seller)

        const [escrowPDA] = getEscrowPDA(assetPubkey, sellerPubkey)

        const umi = getUmi(c.env.SOLANA_RPC_URL)
        const asset = await fetchAssetV1(umi, umiPublicKey(assetId))

        const cancelEscrowKeys = [
            { pubkey: sellerPubkey, isSigner: true, isWritable: true },
            { pubkey: assetPubkey, isSigner: false, isWritable: true },
            { pubkey: escrowPDA, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'), isSigner: false, isWritable: false },
        ]

        if (asset.updateAuthority.type === 'Collection' && asset.updateAuthority.address) {
            cancelEscrowKeys.push({
                pubkey: new PublicKey(asset.updateAuthority.address.toString()),
                isSigner: false,
                isWritable: false
            })
        }

        if (asset.pluginHeader) {
            cancelEscrowKeys.push({
                pubkey: new PublicKey(asset.pluginHeader.key),
                isSigner: false,
                isWritable: true
            })
        }

        const cancelEscrowIx = new TransactionInstruction({
            programId: ESCROW_PROGRAM_ID,
            keys: cancelEscrowKeys,
            data: Buffer.from(IDL.instructions[3].discriminator),
        })

        const connection = new Connection(c.env.SOLANA_RPC_URL)
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()

        const tx = new Transaction()
        tx.recentBlockhash = blockhash
        tx.lastValidBlockHeight = lastValidBlockHeight
        tx.feePayer = sellerPubkey
        tx.add(cancelEscrowIx)

        const serializedTx = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        const base64Tx = Buffer.from(serializedTx).toString('base64')

        return c.json({ transaction: base64Tx })
    } catch (error) {
        console.error('Cancel listing error:', error)
        return c.text(`Cancel listing failed: ${error}`, 500)
    }
}
