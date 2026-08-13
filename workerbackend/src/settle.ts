// Reconciling the database with the chain after a wallet-signed action.
//
// Both buy flows built a transaction, handed it to the wallet, and stopped there. Nothing ever
// flipped the listing to SOLD, moved the owner, or wrote a Sale row - so a purchase that fully
// succeeded on chain left the NFT still on sale, still owned by the seller, with an empty sale
// history and platform volume pinned at zero. The same gap swallowed EVM mints whole: the worker
// never signs on Base, so a freshly minted token existed on chain and nowhere in the marketplace.
//
// The client supplies a transaction hash, never an outcome. Every handler here verifies that
// hash on chain and then re-reads ownership from the chain itself, so a caller cannot report a
// sale that did not happen or a token they do not own.

import { Context } from 'hono'
import { fetchAssetV1 } from '@metaplex-foundation/mpl-core'
import { publicKey as umiPublicKey } from '@metaplex-foundation/umi'
import { type Address } from 'viem'
import { getUmi } from './umi'
import { withPrisma, getConnectionString, ensureUser } from './db'
import { parseAssetId, normalizeAddress, solanaRpc, type Chain } from './chains'
import { verifySolanaTransaction } from './solana'
import {
    verifyEvmTransaction, readAsset, readListing, evmContracts,
    tokenIdFromMintReceipt, listingIdFromReceipt,
} from './evm'
import { resolveMetadata } from './metadata'

/**
 * Who owns the asset according to the chain, not according to the caller.
 *
 * Returns null when the asset cannot be read at all, which callers must treat as "do not write
 * anything" rather than "nobody owns it".
 */
const ownerOnChain = async (
    env: CloudflareBindings,
    assetId: string
): Promise<string | null> => {
    const parsed = parseAssetId(assetId)
    if (!parsed) return null

    if (parsed.chain === 'ETHEREUM') {
        const asset = await readAsset(env, parsed.contractAddress as Address, BigInt(parsed.tokenId))
        return asset?.ownerAddress ?? null
    }

    try {
        const asset = await fetchAssetV1(getUmi(solanaRpc(env)), umiPublicKey(parsed.mintAddress))
        return asset.owner.toString()
    } catch (e) {
        console.error('settle: could not read solana asset owner:', e)
        return null
    }
}

/**
 * Turn one on-chain ERC-721 token into a database row.
 *
 * Shared with the admin backfill so a token indexed by either path lands identically - the
 * upsert used to be written out twice, which is how the two drift apart.
 */
export const upsertEvmToken = async (
    env: CloudflareBindings,
    connectionString: string,
    tokenId: bigint
): Promise<{ assetId: string; name: string; imageOk: boolean } | null> => {
    const asset = await readAsset(env, evmContracts(env).nft, tokenId)
    if (!asset) return null

    const meta = await resolveMetadata(env, asset.tokenUri)

    const row = await withPrisma(connectionString, (prisma) =>
        prisma.nft.upsert({
            where: { assetId: asset.assetId },
            // Ownership and metadata are re-read from chain on every pass, so a transfer or a
            // recovered metadata host is picked up rather than frozen at first index.
            update: {
                ownerAddress: asset.ownerAddress,
                metadataUri: asset.tokenUri,
                ...(meta.name ? { name: meta.name } : {}),
                imageUrl: meta.imageUrl,
                animationUrl: meta.animationUrl,
                description: meta.description,
                category: meta.category,
                attributes: meta.attributes ?? undefined,
                imageOk: meta.imageOk,
            },
            create: {
                chain: 'ETHEREUM',
                chainId: asset.chainId,
                assetId: asset.assetId,
                contractAddress: asset.contractAddress,
                tokenId: asset.tokenId,
                // ERC-721 stores no per-token name, so it comes from the metadata.
                name: meta.name ?? `Token #${asset.tokenId}`,
                metadataUri: asset.tokenUri,
                imageUrl: meta.imageUrl,
                animationUrl: meta.animationUrl,
                description: meta.description,
                category: meta.category,
                attributes: meta.attributes ?? undefined,
                imageOk: meta.imageOk,
                ownerAddress: asset.ownerAddress,
                creatorAddress: asset.ownerAddress,
            },
        })
    )

    return { assetId: row.assetId, name: row.name, imageOk: row.imageOk }
}

/**
 * POST /api/evm/index-token   { txHash }
 *
 * Makes a Base mint visible. Public rather than admin-only because the person who just paid for
 * the mint is the one who needs the row, and it grants nothing: the token id comes out of the
 * receipt of a transaction that has already succeeded, and every field is then read from chain.
 */
export const indexEvmToken = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    let body: any
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const txHash = typeof body?.txHash === 'string' ? body.txHash.trim() : ''
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        return c.json({ error: 'A valid txHash is required' }, 400)
    }

    // The token id comes from the Minted event in this transaction's own receipt. Reading
    // totalMinted instead would hand back a lagging node's stale count and index the wrong token.
    const tokenId = await tokenIdFromMintReceipt(c.env, txHash)
    if (tokenId === null) {
        return c.json({ error: 'No successful Kumule mint found in that transaction', txHash }, 400)
    }

    try {
        const row = await upsertEvmToken(c.env, connectionString, BigInt(tokenId))
        if (!row) return c.json({ error: 'Token does not exist on chain', tokenId }, 404)
        return c.json({ success: true, tokenId, ...row })
    } catch (e: any) {
        console.error('indexEvmToken failed:', e)
        return c.json({ error: 'Failed to index token', details: e?.message }, 500)
    }
}

/**
 * POST /api/evm/index-listing   { txHash }
 *
 * Mirrors a Base listing into the database as soon as it is created, instead of leaving it
 * invisible until an admin runs the backfill. The listing id comes from the Listed event in
 * this transaction's receipt, and price and seller are then read from the contract - so the
 * row always matches what a buyer would actually pay.
 */
export const indexEvmListing = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    let body: any
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const txHash = typeof body?.txHash === 'string' ? body.txHash.trim() : ''
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        return c.json({ error: 'A valid txHash is required' }, 400)
    }

    const listingId = await listingIdFromReceipt(c.env, txHash)
    if (listingId === null) {
        return c.json({ error: 'No Kumule listing found in that transaction', txHash }, 400)
    }

    const onChain = await readListing(c.env, BigInt(listingId))
    if (!onChain) return c.json({ error: 'Listing does not exist on chain', listingId }, 404)
    if (!onChain.active) return c.json({ error: 'Listing is no longer active', listingId }, 409)

    try {
        const result = await withPrisma(connectionString, async (prisma) => {
            const nft = await prisma.nft.findUnique({
                where: { assetId: onChain.assetId },
                select: { id: true },
            })
            if (!nft) return null

            await ensureUser(prisma, 'ETHEREUM', onChain.seller)

            const existing = await prisma.listing.findFirst({
                where: { nftId: nft.id, chain: 'ETHEREUM', sellerAddress: onChain.seller, status: 'ACTIVE' },
                orderBy: { createdAt: 'desc' },
            })

            if (existing) {
                return prisma.listing.update({
                    where: { id: existing.id },
                    data: { price: onChain.price, listTxHash: txHash },
                })
            }
            return prisma.listing.create({
                data: {
                    nftId: nft.id,
                    chain: 'ETHEREUM',
                    sellerAddress: onChain.seller,
                    // Decimal string derived from the contract's wei value, never a float.
                    price: onChain.price,
                    currency: 'ETH',
                    status: 'ACTIVE',
                    listTxHash: txHash,
                },
            })
        })

        if (!result) {
            return c.json({ error: 'That token is not indexed yet', assetId: onChain.assetId }, 404)
        }
        return c.json({
            success: true,
            listingId,
            assetId: onChain.assetId,
            price: onChain.price,
            currency: 'ETH',
        })
    } catch (e: any) {
        console.error('indexEvmListing failed:', e)
        return c.json({ error: 'Failed to record listing', details: e?.message }, 500)
    }
}

/**
 * POST /api/settle   { assetId, txHash }
 *
 * Records the result of a purchase that already landed on chain. Idempotent: Sale.txHash is
 * unique, so replaying the same hash cannot double-count volume, and the client is free to
 * retry after a dropped response.
 */
export const settle = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    let body: any
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const assetId = typeof body?.assetId === 'string' ? body.assetId.trim() : ''
    const txHash = typeof body?.txHash === 'string' ? body.txHash.trim() : ''
    const buyer = typeof body?.buyer === 'string' ? body.buyer.trim() : ''
    if (!assetId || !txHash || !buyer) {
        return c.json({ error: 'assetId, txHash and buyer are required' }, 400)
    }

    const parsed = parseAssetId(assetId)
    if (!parsed) return c.json({ error: 'assetId is not a recognised asset' }, 400)
    const chain: Chain = parsed.chain

    // Fails closed. An unreachable RPC, a missing receipt or a reverted transaction all stop
    // here rather than settling a sale that never happened.
    const confirmed =
        chain === 'ETHEREUM'
            ? await verifyEvmTransaction(c.env, txHash)
            : await verifySolanaTransaction(c.env, txHash)
    if (!confirmed) {
        return c.json({ error: 'Transaction did not confirm successfully', txHash }, 400)
    }

    const owner = await ownerOnChain(c.env, assetId)
    if (!owner) return c.json({ error: 'Could not read the asset owner from chain' }, 502)
    const ownerAddress = normalizeAddress(chain, owner)

    // The claimed buyer has to be the address the chain actually shows holding the asset.
    //
    // Writing whatever owner came back instead is how a sale got recorded against an escrow
    // PDA: an asset sitting in escrow is owned by the program, not by a person, so a lagging
    // read during a purchase replaced a real owner with a program address. A mismatch is
    // retryable rather than fatal - the caller may simply be ahead of the node.
    if (ownerAddress !== normalizeAddress(chain, buyer)) {
        return c.json(
            {
                error: 'Ownership has not moved to the buyer yet',
                ownerOnChain: ownerAddress,
                buyer: normalizeAddress(chain, buyer),
                retryable: true,
            },
            409
        )
    }

    try {
        const result = await withPrisma(connectionString, async (prisma) => {
            const nft = await prisma.nft.findUnique({
                where: { assetId },
                include: {
                    listings: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 1 },
                },
            })
            if (!nft) return { error: 'NFT not found' as const, code: 404 as const }

            const listing = nft.listings[0] ?? null
            const changedHands = normalizeAddress(chain, nft.ownerAddress) !== ownerAddress

            // The chain is the authority on ownership, so this is refreshed whether or not there
            // was a listing - a plain transfer still needs to move the card to its new owner.
            if (changedHands) {
                await ensureUser(prisma, chain, ownerAddress)
                await prisma.nft.update({ where: { id: nft.id }, data: { ownerAddress } })
            }

            if (!listing || !changedHands) {
                // An active listing whose owner did not move is not a sale. Left ACTIVE on
                // purpose: guessing "cancelled" here would delist assets over a lagging read.
                return {
                    settled: false as const,
                    ownerAddress,
                    ownerChanged: changedHands,
                    reason: listing ? 'owner unchanged on chain' : 'no active listing to settle',
                }
            }

            const sale = await prisma.sale.upsert({
                where: { txHash },
                update: {},
                create: {
                    nftId: nft.id,
                    listingId: listing.id,
                    chain,
                    sellerAddress: listing.sellerAddress,
                    buyerAddress: ownerAddress,
                    // Price comes off the listing row, which was written from the chain's own
                    // value as a decimal string - never re-derived from a display number.
                    price: listing.price,
                    currency: listing.currency,
                    txHash,
                },
            })

            await prisma.listing.update({
                where: { id: listing.id },
                data: { status: 'SOLD', closeTxHash: txHash },
            })

            // The Solana buy path opens a PENDING row before the wallet signs; finish that one
            // rather than leaving it pending forever beside a second, identical record.
            const pending = await prisma.transaction.findFirst({
                where: {
                    chain,
                    kind: 'PURCHASE',
                    status: 'PENDING',
                    walletAddress: ownerAddress,
                    txHash: null,
                },
                orderBy: { createdAt: 'desc' },
            })

            if (pending) {
                await prisma.transaction.update({
                    where: { id: pending.id },
                    data: { status: 'CONFIRMED', txHash },
                })
            } else {
                // Base purchases are signed entirely in the browser, so no row exists yet.
                await prisma.transaction.upsert({
                    where: { txHash },
                    update: { status: 'CONFIRMED' },
                    create: {
                        chain,
                        kind: 'PURCHASE',
                        status: 'CONFIRMED',
                        walletAddress: ownerAddress,
                        amount: listing.price,
                        currency: listing.currency,
                        txHash,
                        metadata: { source: 'settle', assetId, seller: listing.sellerAddress },
                    },
                })
            }

            return {
                settled: true as const,
                saleId: sale.id,
                ownerAddress,
                ownerChanged: true,
                price: listing.price.toString(),
                currency: listing.currency,
                sellerAddress: listing.sellerAddress,
            }
        })

        if ('error' in result) return c.json({ error: result.error }, result.code)
        return c.json({ success: true, assetId, txHash, chain, ...result })
    } catch (e: any) {
        console.error('settle failed:', e)
        return c.json({ error: 'Failed to settle', details: e?.message }, 500)
    }
}
