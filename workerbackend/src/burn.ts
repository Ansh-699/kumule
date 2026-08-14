// Burning an MPL Core asset on Solana devnet.
//
// Two steps, deliberately. Burning is irreversible and the worker holds no user key, so:
//
//   POST /api/solana/burn          -> unsigned transaction for the owner's wallet to sign
//   POST /api/solana/burn/confirm  -> verifies the signature on chain, then drops the row
//
// The database row is removed only after the chain confirms the burn. Deleting first would
// leave an asset that still exists on chain invisible to the marketplace, with no way to
// notice - the inverse of v1's problem, where rows described assets nobody could render.

import { Context } from 'hono'
import { createNoopSigner, publicKey, signerIdentity } from '@metaplex-foundation/umi'
import { burnV1 } from '@metaplex-foundation/mpl-core'
import { getUmi } from './umi'
import { withPrisma, getConnectionString } from './db'
import { solanaRpc, isSolanaAddress } from './chains'
import { verifySolanaTransaction } from './solana'
import { logSecurityEvent, auditedTransactionData } from './audit'

/** POST /api/solana/burn — build the unsigned burn transaction. */
export const burnNft = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    let body: any
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const { assetId, owner } = body
    if (!assetId || !owner) return c.json({ error: 'assetId and owner are required' }, 400)
    if (!isSolanaAddress(assetId)) return c.json({ error: 'assetId is not a Solana address' }, 400)
    if (!isSolanaAddress(owner)) return c.json({ error: 'owner is not a Solana address' }, 400)

    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    try {
        const nft = await withPrisma(connectionString, (prisma) =>
            prisma.nft.findUnique({
                where: { assetId },
                include: { listings: { where: { status: 'ACTIVE' } }, medal: true },
            })
        )
        if (!nft) return c.json({ error: 'NFT not found' }, 404)
        if (nft.chain !== 'SOLANA') {
            return c.json({ error: 'Only Solana assets can be burned here' }, 400)
        }

        // Only the recorded owner may burn. The chain would reject anyone else anyway, but
        // refusing here avoids handing out a transaction that can only fail.
        if (nft.ownerAddress !== owner) {
            logSecurityEvent('unauthorized_access', {
                actor: owner,
                target: assetId,
                metadata: { reason: 'burn_not_owner', recordedOwner: nft.ownerAddress },
            })
            return c.json({ error: 'Only the owner can burn this asset' }, 403)
        }

        // An asset sitting in escrow is not the seller's to destroy: the escrow PDA holds it,
        // and burning underneath a live listing would strand any buyer mid-purchase.
        if (nft.listings.length > 0) {
            return c.json(
                { error: 'Cancel the active listing before burning this asset' },
                409
            )
        }

        // Medals are the marketplace's own supply. Burning one would leave an event promising a
        // reward that no longer exists.
        if (nft.medal) {
            return c.json({ error: 'Event medals cannot be burned' }, 409)
        }

        const umi = getUmi(solanaRpc(c.env))
        const ownerSigner = createNoopSigner(publicKey(owner))
        umi.use(signerIdentity(ownerSigner, true))

        const builder = await burnV1(umi, {
            asset: publicKey(assetId),
            authority: ownerSigner,
            collection: undefined,
        })
            .setFeePayer(ownerSigner)
            .setLatestBlockhash(umi)

        const tx = await builder.build(umi)
        const base64Tx = Buffer.from(umi.transactions.serialize(tx)).toString('base64')

        return c.json({
            transaction: base64Tx,
            assetId,
            name: nft.name,
            warning: 'Burning is irreversible. The asset is destroyed on chain.',
        })
    } catch (e: any) {
        console.error('burnNft failed:', e)
        return c.json({ error: 'Failed to build burn transaction', details: e?.message }, 500)
    }
}

/**
 * POST /api/solana/burn/confirm — verify the burn landed, then remove the row.
 *
 * The signature is checked against the chain rather than trusted from the caller: without that
 * anyone could delete any asset's row by posting a made-up signature.
 */
export const confirmBurn = async (c: Context<{ Bindings: CloudflareBindings }>) => {
    let body: any
    try {
        body = await c.req.json()
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const { assetId, signature } = body
    if (!assetId || !signature) {
        return c.json({ error: 'assetId and signature are required' }, 400)
    }
    // Validated here, not just in burnNft: a malformed assetId used to reach publicKey()
    // inside the try below and come back as a 500 "Failed to record the burn".
    if (!isSolanaAddress(assetId)) return c.json({ error: 'assetId is not a Solana address' }, 400)

    const connectionString = getConnectionString(c.env)
    if (!connectionString) return c.json({ error: 'Database not configured' }, 503)

    const verified = await verifySolanaTransaction(c.env, signature)
    if (!verified) {
        logSecurityEvent('invalid_signature', {
            actor: 'unknown',
            target: assetId,
            metadata: { reason: 'burn_confirm_unverified', signature },
        })
        return c.json({ error: 'Signature did not confirm on chain; nothing was removed' }, 400)
    }

    try {
        // The asset must genuinely be gone. burnV1 closes the account, so a successful read
        // means something other than a burn confirmed under this signature.
        //
        // This is the only authorization control on this endpoint - confirmBurn takes no owner
        // and the signature is not checked to be a burn *of this asset* - so it must fail
        // closed. It used to `.catch(() => null)`, which made an RPC error indistinguishable
        // from "the account is gone" and deleted the row anyway. With a paid RPC key that 401s
        // (the failure this codebase already carries fallbacks for elsewhere), any caller could
        // delete any NFT row by replaying one unrelated confirmed signature.
        const umi = getUmi(solanaRpc(c.env))
        let stillThere
        try {
            stillThere = await umi.rpc.getAccount(publicKey(assetId))
        } catch (rpcError: any) {
            console.error('confirmBurn could not read the asset account:', rpcError?.message ?? rpcError)
            return c.json(
                { error: 'Could not verify on chain that the asset was burned; nothing was removed' },
                503
            )
        }
        if (stillThere?.exists) {
            return c.json(
                { error: 'That transaction confirmed but the asset still exists on chain' },
                409
            )
        }

        const removed = await withPrisma(connectionString, async (prisma) => {
            const nft = await prisma.nft.findUnique({ where: { assetId }, select: { id: true, name: true } })
            if (!nft) return null
            await prisma.transaction.create({
                data: await auditedTransactionData({
                    chain: 'SOLANA',
                    kind: 'BURN',
                    status: 'CONFIRMED',
                    txHash: signature,
                    assetId,
                    metadata: { name: nft.name },
                }),
            })
            // Cascades clear listings, likes and sales referencing the asset.
            await prisma.nft.delete({ where: { assetId } })
            return nft
        })

        if (!removed) return c.json({ error: 'NFT not found' }, 404)

        return c.json({
            success: true,
            burned: assetId,
            name: removed.name,
            txHash: signature,
            explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
        })
    } catch (e: any) {
        console.error('confirmBurn failed:', e)
        return c.json({ error: 'Failed to record the burn', details: e?.message }, 500)
    }
}
