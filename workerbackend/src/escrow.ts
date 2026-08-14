import { Context } from 'hono'
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'
// @coral-xyz/anchor is deliberately not imported here. It was pulled in for a single BN call
// (serializing the u64 price below) plus Program and AnchorProvider, which were never used at
// all - and that one import could not be written to satisfy both runtimes at once:
//
//   worker bundle (esbuild -> dist/browser/index.js): `export { default as BN } from 'bn.js'`,
//       a static named export, and NO default export.
//   local checks (Node ESM -> dist/cjs/index.js): BN behind a dynamic defineProperty getter
//       that cjs-module-lexer cannot see, so the named import fails to link.
//
// So `import { BN }` builds but breaks the checks, and `import default` passes the checks but
// fails the build. u64ToLeBytes below removes the dilemma and the dependency together.
import { createNoopSigner, publicKey as umiPublicKey, signerIdentity } from '@metaplex-foundation/umi'
import { getUmi } from './umi'
import { fetchAssetV1, getAssetV1GpaBuilder } from '@metaplex-foundation/mpl-core'
import { withPrisma, getConnectionString, ensureUser } from './db'
import { fromBaseUnits, toBaseUnits } from './chains'
import { verifySolanaTransaction } from './solana'
import { logBlockchainTransaction, logAudit, auditedTransactionData } from './audit'

// Lazy initialization to avoid module-level PublicKey creation issues
// Using the deployed escrow program ID (this is the actual deployed program on devnet)
const getEscrowProgramId = () => new PublicKey('3ozh4TQJbeyXFUuXsj7fYmHB5aCVkg24cZN5zZmigR44')

// Buffer is set globally in index.ts
const ESCROW_SEED = Buffer.from('escrow')

/**
 * A connection that reads at 'confirmed', never the web3.js default of 'finalized'.
 *
 * Every read in this file happens moments after a transaction the caller has already watched
 * confirm, and finalization trails that by roughly fifteen seconds. At the default the account
 * still looked untouched: a freshly created escrow read back as "no escrow account exists", and
 * a completed purchase read back the previous owner.
 */
const rpcConnection = (url: string) => new Connection(url, 'confirmed')

function getEscrowPDA(asset: PublicKey, seller: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [ESCROW_SEED, asset.toBuffer(), seller.toBuffer()],
        getEscrowProgramId()
    )
}


interface EscrowAccount {
    asset: PublicKey
    seller: PublicKey
    buyer: PublicKey | null
    price: bigint
    bump: number
    status: number // 0=Pending, 1=Deposited, 2=Completed, 3=Cancelled, 4=Disputed
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

const getIDL = () => ({
    address: getEscrowProgramId().toBase58(),
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
        {
            name: 'admin_resolve',
            discriminator: [90, 215, 29, 95, 17, 61, 118, 229],
            accounts: [
                { name: 'admin', writable: true, signer: true },
                { name: 'seller', writable: true },
                { name: 'buyer', writable: true },
                { name: 'asset', writable: true },
                { name: 'escrow', writable: true },
                { name: 'system_program', address: '11111111111111111111111111111111' },
                { name: 'mpl_core_program', address: 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d' },
            ],
            args: [
                { name: 'refund_buyer', type: 'bool' },
            ],
        },
    ],
})

/**
 * Instruction discriminators keyed by name instead of by position in `getIDL().instructions`.
 * Byte-identical to the literals inline in `getIDL()` above - reordering that array (an easy
 * mistake in an unrelated edit) used to silently point every positional call site at the wrong
 * instruction.
 */
export const INSTRUCTION_DISCRIMINATORS: Record<string, number[]> = {
    create_escrow: [253, 215, 165, 116, 36, 108, 68, 80],
    deposit_asset: [107, 93, 89, 87, 226, 203, 154, 19],
    buy_asset: [197, 37, 177, 1, 180, 23, 175, 98],
    cancel_escrow: [156, 203, 54, 179, 38, 72, 33, 21],
    close_escrow: [139, 171, 94, 146, 191, 91, 144, 50],
    admin_resolve: [90, 215, 29, 95, 17, 61, 118, 229],
}

/**
 * A u64 as 8 little-endian bytes - the layout `create_escrow` expects for `price`.
 *
 * Replaces `new BN(v.toString()).toArray('le', 8)`; see the note at the top of this file for why
 * anchor's BN is not importable in a form that works in both the worker bundle and the local
 * checks. This also keeps the value an integer end to end rather than round-tripping it through
 * a decimal string.
 *
 * The range check is not decoration. BN.toArray('le', 8) throws on a value too large for 8
 * bytes; without an equivalent guard the price would silently wrap to its low 64 bits and the
 * asset would be listed for an amount nobody chose.
 */
export const u64ToLeBytes = (value: bigint): number[] => {
    if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
        throw new Error(`price does not fit in a u64: ${value}`)
    }
    const bytes = new Array<number>(8)
    for (let i = 0; i < 8; i++) bytes[i] = Number((value >> BigInt(8 * i)) & 0xffn)
    return bytes
}

/**
 * Every handler in this file hits the same failure mode: a paid RPC key that is missing,
 * expired, or revoked reads back as a 401/"Invalid API key"/"Unauthorized", and the fix is
 * always "retry the same call against the public devnet RPC". This used to be eight separate
 * copies of that catch-and-retry, one of them (syncListing's) missing entirely - a purchase
 * that already landed on chain could fail to *sync* into the database purely because the paid
 * RPC key 401'd, which read to the caller as the purchase itself failing.
 *
 * `extraPatterns` lets UMI-backed call sites (`fetchAssetV1` throws differently-shaped errors,
 * e.g. "AccountNotFoundError") keep matching exactly the strings they matched before this was
 * deduplicated, without loosening the match for call sites that never saw those messages.
 */
async function withRpcFallback<T>(
    primaryUrl: string,
    attempt: (rpcUrl: string) => Promise<T>,
    extraPatterns: string[] = [],
): Promise<T> {
    try {
        return await attempt(primaryUrl)
    } catch (e: any) {
        const msg = e?.message ?? String(e)
        const patterns = ['401', 'Invalid API key', 'Unauthorized', ...extraPatterns]
        if (patterns.some((p) => msg.includes(p))) {
            return await attempt('https://api.devnet.solana.com')
        }
        throw e
    }
}

export const getListings = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        // Use public devnet RPC as fallback if API key is invalid
        const rpcUrl = c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'

        let accounts: any[]
        try {
            console.log('Fetching program accounts for:', getEscrowProgramId().toBase58())
            accounts = await withRpcFallback(rpcUrl, (url) => rpcConnection(url).getProgramAccounts(getEscrowProgramId())) as any[]
            console.log(`Found ${accounts.length} program accounts`)
        } catch (e: any) {
            console.error('Error fetching program accounts (including fallback):', e?.message ?? e)
            return c.json({ listings: [] })
        }

        const listings = []

        for (const { pubkey, account } of accounts) {
            try {
                const escrowData = parseEscrowAccount(account.data)

                if (escrowData.status !== 1) {
                    continue
                }

                const asset = await withRpcFallback(
                    rpcUrl,
                    (url) => fetchAssetV1(getUmi(url), umiPublicKey(escrowData.asset.toBase58())),
                    ['failed to get info'],
                )

                listings.push({
                    escrow: pubkey.toBase58(),
                    asset: escrowData.asset.toBase58(),
                    seller: escrowData.seller.toBase58(),
                    // fromBaseUnits, not Number(price)/1e9: the on-chain price is a u64 and
                    // dividing it through a float is how a listing shows a price nobody set.
                    price: fromBaseUnits(escrowData.price, 'SOLANA'),
                    priceLamports: escrowData.price.toString(),
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
        // Parsed straight to lamports as a bigint. toBaseUnits rejects a non-numeric price
        // and anything finer than 9 decimals rather than silently rounding it.
        let priceLamports: bigint
        try {
            priceLamports = toBaseUnits(String(price), 'SOLANA')
        } catch (e: any) {
            return c.text(`Invalid price: ${e?.message ?? 'not a decimal amount'}`, 400)
        }
        if (priceLamports <= 0n) {
            return c.text('Invalid price: must be greater than zero', 400)
        }

        const [escrowPDA] = getEscrowPDA(assetPubkey, sellerPubkey)
        
        // Use public devnet RPC as fallback if API key is invalid
        let rpcUrl = c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
        let connection = rpcConnection(rpcUrl)

        const tx = new Transaction()

        const escrowAccountInfo = await withRpcFallback(rpcUrl, async (url) => {
            rpcUrl = url
            connection = rpcConnection(url)
            return connection.getAccountInfo(escrowPDA)
        })

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
                        programId: getEscrowProgramId(),
                        keys: [
                            { pubkey: sellerPubkey, isSigner: true, isWritable: true },
                            { pubkey: escrowPDA, isSigner: false, isWritable: true },
                        ],
                        data: Buffer.from(INSTRUCTION_DISCRIMINATORS.close_escrow),
                    })
                    tx.add(closeEscrowIx)
                }
            } catch (e) {
                console.error('Error parsing existing escrow account:', e)

                if (escrowAccountInfo.owner.equals(getEscrowProgramId())) {
                    console.log('Account owned by program but parse failed, attempting to close...')
                    const closeEscrowIx = new TransactionInstruction({
                        programId: getEscrowProgramId(),
                        keys: [
                            { pubkey: sellerPubkey, isSigner: true, isWritable: true },
                            { pubkey: escrowPDA, isSigner: false, isWritable: true },
                        ],
                        data: Buffer.from(INSTRUCTION_DISCRIMINATORS.close_escrow),
                    })
                    tx.add(closeEscrowIx)
                }
            }
        }

        const createEscrowIx = new TransactionInstruction({
            programId: getEscrowProgramId(),
            keys: [
                { pubkey: sellerPubkey, isSigner: true, isWritable: true },
                { pubkey: assetPubkey, isSigner: false, isWritable: false },
                { pubkey: escrowPDA, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data: Buffer.from([
                ...INSTRUCTION_DISCRIMINATORS.create_escrow,
                // From the bigint base-unit value, never priceNum * 1e9. That multiplication is
                // a float: 1.1 * 1e9 is 1100000000.0000002, so the price written on-chain would
                // not be the price the seller typed.
                ...u64ToLeBytes(priceLamports),
                0,
            ]),
        })

        // Use the same RPC URL for UMI (with fallback)
        let umi = getUmi(rpcUrl)
        const asset = await withRpcFallback(
            rpcUrl,
            async (url) => {
                rpcUrl = url
                connection = rpcConnection(url)
                umi = getUmi(url)
                return fetchAssetV1(umi, umiPublicKey(assetId))
            },
            ['failed to get info', 'AccountNotFoundError', 'was not found'],
        )

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
            programId: getEscrowProgramId(),
            keys: depositAssetKeys,
            data: Buffer.from(INSTRUCTION_DISCRIMINATORS.deposit_asset),
        })

        const { blockhash, lastValidBlockHeight } = await withRpcFallback(rpcUrl, async (url) => {
            rpcUrl = url
            connection = rpcConnection(url)
            return connection.getLatestBlockhash()
        })

        tx.recentBlockhash = blockhash
        tx.lastValidBlockHeight = lastValidBlockHeight
        tx.feePayer = sellerPubkey
        tx.add(createEscrowIx, depositAssetIx)

        const serializedTx = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        const base64Tx = Buffer.from(serializedTx).toString('base64')

        // Deliberately no database write here. This handler only builds an unsigned transaction;
        // the seller may still reject it in their wallet. Creating the ACTIVE listing at this
        // point advertised assets that had never been deposited into escrow, so every buyer's
        // transaction failed against an escrow that did not exist. The row is written by
        // confirmListing once the deposit is on chain - the same build-then-confirm split the
        // burn flow uses.

        // Log successful listing transaction
        logBlockchainTransaction({
            action: 'list_nft',
            walletAddress: seller,
            assetId: assetId,
            escrowAddress: escrowPDA.toBase58(),
            success: true
        })

        return c.json({ transaction: base64Tx, escrow: escrowPDA.toBase58() })
    } catch (error) {
        console.error('List NFT error:', error)
        
        // Log failed listing attempt
        logBlockchainTransaction({
            action: 'list_nft',
            walletAddress: 'unknown',
            success: false,
            error: error instanceof Error ? error.message : String(error)
        })
        
        return c.text(`List NFT failed: ${error}`, 500)
    }
}

/**
 * POST /api/solana/listing/sync   { assetId, seller, signature }
 *
 * Makes the listing row match the escrow account, whichever way it went.
 *
 * One endpoint rather than a confirm for listing and another for cancelling, because both
 * questions have the same answer: is this asset sitting in escrow right now? Listing and
 * cancelling used to write the database while building the unsigned transaction, so rejecting
 * the wallet prompt either advertised an NFT that was never escrowed - every buyer's
 * transaction then failed against an escrow that did not exist - or hid one that still was.
 *
 * The price is read back out of the escrow rather than taken from the request: the escrow is
 * what a buyer actually pays against, so a client cannot advertise 1 SOL for an asset
 * escrowed at 40.
 */
export const syncListing = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    let body: any
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const { assetId, seller, signature } = body ?? {}
    if (!assetId || !seller || !signature) {
        return c.json({ error: 'assetId, seller and signature are required' }, 400)
    }

    // Fails closed on an unreachable RPC or a reverted transaction.
    if (!(await verifySolanaTransaction(c.env, signature))) {
        return c.json({ error: 'Transaction did not confirm successfully', signature }, 400)
    }

    let assetPubkey: PublicKey
    let sellerPubkey: PublicKey
    try {
        assetPubkey = new PublicKey(assetId)
        sellerPubkey = new PublicKey(seller)
    } catch {
        return c.json({ error: 'assetId or seller is not a valid address' }, 400)
    }

    const [escrowPDA] = getEscrowPDA(assetPubkey, sellerPubkey)
    const rpcUrl = c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'

    // Same fallback every other handler in this file already has: a paid RPC key that 401s
    // used to fail this call outright, which read to the caller as the purchase itself
    // failing even though it had already landed on chain.
    const info = await withRpcFallback(rpcUrl, (url) => rpcConnection(url).getAccountInfo(escrowPDA))

    // 1 = Deposited. Anything else - no account, a closed one, a cancelled one - means the asset
    // is not held for sale, whatever the caller believes.
    let escrow: EscrowAccount | null = null
    if (info) {
        try {
            escrow = parseEscrowAccount(info.data)
        } catch {
            escrow = null
        }
    }
    const escrowed = escrow?.status === 1
    const price = escrowed ? fromBaseUnits(escrow!.price, 'SOLANA') : null

    try {
        const outcome = await withPrisma(connectionString, async (prisma) => {
            await ensureUser(prisma, 'SOLANA', seller)
            const nft = await prisma.nft.findUnique({ where: { assetId }, select: { id: true } })
            if (!nft) return null

            // Only an owner can deposit into escrow, and only a seller gets one back, so either
            // way this address holds the asset. While it is escrowed the on-chain owner is the
            // program's PDA, so the marketplace keeps showing the person - and this repairs any
            // row that recorded a PDA as the owner.
            await prisma.nft.update({ where: { id: nft.id }, data: { ownerAddress: seller } })

            const existing = await prisma.listing.findFirst({
                where: { nftId: nft.id, sellerAddress: seller, status: 'ACTIVE' },
            })

            if (!escrowed) {
                if (existing) {
                    await prisma.listing.update({
                        where: { id: existing.id },
                        data: { status: 'CANCELLED', closeTxHash: signature },
                    })
                }
                return { state: 'CANCELLED' as const }
            }

            if (existing) {
                await prisma.listing.update({
                    where: { id: existing.id },
                    data: { price: price!, escrowPda: escrowPDA.toBase58(), listTxHash: signature },
                })
            } else {
                await prisma.listing.create({
                    data: {
                        nftId: nft.id,
                        chain: 'SOLANA',
                        sellerAddress: seller,
                        price: price!,
                        currency: 'SOL',
                        status: 'ACTIVE',
                        escrowPda: escrowPDA.toBase58(),
                        listTxHash: signature,
                    },
                })
            }
            return { state: 'ACTIVE' as const }
        })

        if (!outcome) return c.json({ error: 'NFT not found' }, 404)
        return c.json({
            success: true,
            assetId,
            state: outcome.state,
            price,
            currency: 'SOL',
            escrowPda: escrowPDA.toBase58(),
        })
    } catch (e: any) {
        console.error('syncListing failed:', e)
        return c.json({ error: 'Failed to sync listing', details: e?.message }, 500)
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

        // Fetch asset with RPC fallback
        let rpcUrl = c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
        let umi = getUmi(rpcUrl)
        const asset = await withRpcFallback(
            rpcUrl,
            async (url) => {
                rpcUrl = url
                umi = getUmi(url)
                return fetchAssetV1(umi, umiPublicKey(assetId))
            },
            ['AccountNotFoundError', 'was not found'],
        )

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
            programId: getEscrowProgramId(),
            keys: buyAssetKeys,
            data: Buffer.from(INSTRUCTION_DISCRIMINATORS.buy_asset),
        })

        const connection = rpcConnection(rpcUrl)
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()

        const tx = new Transaction()
        tx.recentBlockhash = blockhash
        tx.lastValidBlockHeight = lastValidBlockHeight
        tx.feePayer = buyerPubkey
        tx.add(buyAssetIx)

        const serializedTx = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        const base64Tx = Buffer.from(serializedTx).toString('base64')

        // Track buyer in database and record the purchase
        const connectionString = getConnectionString(c.env)
        if (connectionString) {
            try {
                await withPrisma(connectionString, async (prisma) => {
                    const buyerUserId = await ensureUser(prisma, 'SOLANA', buyer)
                    console.log('Buy DB: buyer tracked', buyer)
                    await ensureUser(prisma, 'SOLANA', seller)

                    // Every other call site defaults to public devnet; this one threw on an
                    // unset secret because new Connection(undefined) rejects the endpoint.
                    const connection = rpcConnection(c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com')
                    const escrowAccountInfo = await connection.getAccountInfo(escrowPDA)
                    // Decimal string throughout. The escrow price is a u64 of lamports, so it
                    // converts exactly rather than via Number()/1e9.
                    let priceSol = '0'
                    if (escrowAccountInfo) {
                        const escrowData = parseEscrowAccount(escrowAccountInfo.data)
                        priceSol = fromBaseUnits(escrowData.price, 'SOLANA')
                    }

                    const nft = await prisma.nft.findUnique({ where: { assetId } })

                    // PENDING until the signed transaction actually lands. The buy instruction
                    // is returned unsigned, so nothing here proves settlement yet - the
                    // indexer flips this to CONFIRMED and writes the Sale row.
                    await prisma.transaction.create({
                        data: await auditedTransactionData({
                            chain: 'SOLANA',
                            kind: 'PURCHASE',
                            status: 'PENDING',
                            userId: buyerUserId,
                            walletAddress: buyer,
                            amount: priceSol,
                            assetId,
                            metadata: {
                                source: 'escrow_purchase',
                                nftRowId: nft?.id ?? null,
                                seller,
                                price: priceSol,
                                escrowPda: escrowPDA.toBase58(),
                            },
                        }),
                    })
                    console.log('Buy DB: transaction recorded (PENDING)')
                })
            } catch (e) {
                console.error('Failed to track buyer in DB:', e)
                // Don't block the transaction
            }
        }

        // Log successful buy transaction
        logBlockchainTransaction({
            action: 'buy_nft',
            walletAddress: buyer,
            assetId: assetId,
            success: true
        })

        return c.json({ transaction: base64Tx })
    } catch (error) {
        console.error('Buy NFT error:', error)
        
        // Log failed buy attempt
        logBlockchainTransaction({
            action: 'buy_nft',
            walletAddress: 'unknown',
            success: false,
            error: error instanceof Error ? error.message : String(error)
        })
        
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

        // Fetch asset with RPC fallback
        let rpcUrl = c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
        let umi = getUmi(rpcUrl)
        const asset = await withRpcFallback(
            rpcUrl,
            async (url) => {
                rpcUrl = url
                umi = getUmi(url)
                return fetchAssetV1(umi, umiPublicKey(assetId))
            },
            ['AccountNotFoundError', 'was not found'],
        )

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
            programId: getEscrowProgramId(),
            keys: cancelEscrowKeys,
            data: Buffer.from(INSTRUCTION_DISCRIMINATORS.cancel_escrow),
        })

        const connection = rpcConnection(rpcUrl)
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()

        const tx = new Transaction()
        tx.recentBlockhash = blockhash
        tx.lastValidBlockHeight = lastValidBlockHeight
        tx.feePayer = sellerPubkey
        tx.add(cancelEscrowIx)

        const serializedTx = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        const base64Tx = Buffer.from(serializedTx).toString('base64')

        // No database write here either. This only builds an unsigned transaction, and marking
        // the listing CANCELLED at this point hid an asset that was still sitting in escrow if
        // the seller dismissed their wallet. syncListing records the outcome once it is on chain.

        // Log successful cancel transaction
        logBlockchainTransaction({
            action: 'cancel_listing',
            walletAddress: seller,
            assetId: assetId,
            success: true
        })

        return c.json({ transaction: base64Tx })
    } catch (error) {
        console.error('Cancel listing error:', error)
        
        // Log failed cancel attempt
        logBlockchainTransaction({
            action: 'cancel_listing',
            walletAddress: 'unknown',
            success: false,
            error: error instanceof Error ? error.message : String(error)
        })
        
        return c.text(`Cancel listing failed: ${error}`, 500)
    }
}

export const adminResolveEscrow = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    try {
        const body = await c.req.json()
        const { assetId, seller, buyer, admin, refundBuyer } = body

        if (!assetId || !seller || !buyer || !admin) {
            return c.text('Missing required fields: assetId, seller, buyer, admin', 400)
        }

        if (typeof refundBuyer !== 'boolean') {
            return c.text('refundBuyer must be a boolean', 400)
        }

        const assetPubkey = new PublicKey(assetId)
        const sellerPubkey = new PublicKey(seller)
        const buyerPubkey = new PublicKey(buyer)
        const adminPubkey = new PublicKey(admin)

        const [escrowPDA] = getEscrowPDA(assetPubkey, sellerPubkey)

        // Fetch asset with RPC fallback
        let rpcUrl = c.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
        let umi = getUmi(rpcUrl)
        const asset = await withRpcFallback(
            rpcUrl,
            async (url) => {
                rpcUrl = url
                umi = getUmi(url)
                return fetchAssetV1(umi, umiPublicKey(assetId))
            },
            ['AccountNotFoundError', 'was not found'],
        )

        const adminResolveKeys = [
            { pubkey: adminPubkey, isSigner: true, isWritable: true },
            { pubkey: sellerPubkey, isSigner: false, isWritable: true },
            { pubkey: buyerPubkey, isSigner: false, isWritable: true },
            { pubkey: assetPubkey, isSigner: false, isWritable: true },
            { pubkey: escrowPDA, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'), isSigner: false, isWritable: false },
        ]

        if (asset.updateAuthority.type === 'Collection' && asset.updateAuthority.address) {
            adminResolveKeys.push({
                pubkey: new PublicKey(asset.updateAuthority.address.toString()),
                isSigner: false,
                isWritable: false
            })
        }

        if (asset.pluginHeader) {
            adminResolveKeys.push({
                pubkey: new PublicKey(asset.pluginHeader.key),
                isSigner: false,
                isWritable: true
            })
        }

        // Build instruction data: discriminator + refund_buyer (bool = 1 byte)
        const refundBuyerByte = refundBuyer ? 1 : 0
        const instructionData = Buffer.concat([
            Buffer.from(INSTRUCTION_DISCRIMINATORS.admin_resolve) as any,
            Buffer.from([refundBuyerByte]) as any
        ]) as Buffer

        const adminResolveIx = new TransactionInstruction({
            programId: getEscrowProgramId(),
            keys: adminResolveKeys,
            data: instructionData,
        })

        const connection = rpcConnection(rpcUrl)
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()

        const tx = new Transaction()
        tx.recentBlockhash = blockhash
        tx.lastValidBlockHeight = lastValidBlockHeight
        tx.feePayer = adminPubkey
        tx.add(adminResolveIx)

        const serializedTx = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        const base64Tx = Buffer.from(serializedTx).toString('base64')

        return c.json({ transaction: base64Tx })
    } catch (error) {
        console.error('Admin resolve escrow error:', error)
        return c.text(`Admin resolve failed: ${error}`, 500)
    }
}
