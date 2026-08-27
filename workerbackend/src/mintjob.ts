// The chain half of the Stripe rail: turn a settled payment into an NFT, exactly once.
//
// This runs with no user present, minutes or hours after the card cleared, possibly on a
// different continent, possibly twice at the same moment. Every design choice below exists
// because one of those is true.
//
// The guarantee is "one payment, one mint", enforced in three independent places:
//
//   1. the database - MintJob.paymentId is unique, so a payment cannot own two jobs
//   2. the claim    - a conditional single-row update, the only atomicity primitive this
//                     codebase has (withPrisma opens a fresh client per call and nothing
//                     in src/ uses $transaction)
//   3. the chain    - the asset address is derived from the payment id, so a retry targets
//                     the same account instead of creating a second asset
//
// Layer 3 is what makes retrying safe at all. The asset keypair has to co-sign its own
// creation, so it cannot be stored and re-loaded without putting a private key in the
// database; deriving it from a secret gives the same address every time without storing
// anything.

import {
    createSignerFromKeypair,
    keypairIdentity,
    publicKey,
    type KeypairSigner,
    type Transaction,
} from '@metaplex-foundation/umi'
import { createV1, fetchAsset } from '@metaplex-foundation/mpl-core'
import { base58 } from '@metaplex-foundation/umi/serializers'
import { getUmi, withPriorityFees } from './umi'
import { solanaRpc, makeAssetId, fromBaseUnits } from './chains'
import { verifySolanaTransaction, readFeePayerCost, rpc } from './solana'
import { resolveMetadata } from './metadata'
import { withPrisma, ensureUser } from './db'
import { auditedTransactionData } from './audit'
import { lamportsToEurMinor } from './fx'
import { MAX_MINT_ATTEMPTS, MINT_LEASE_MS } from './config'
import { createRefund } from './stripe'
import { COMPUTE_UNITS, PRIORITY_MICRO_LAMPORTS } from './web3fees'

/** MPL Core. An account owned by anything else at our derived address is not our asset. */
const MPL_CORE_PROGRAM = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'

/** Bumped only if the derivation itself ever changes shape. Not a secret rotation counter. */
export const CURRENT_SEED_VERSION = 1

// --- platform wallet ----------------------------------------------------------------------

/**
 * The wallet that pays for and signs mints.
 *
 * Falls back to MEDAL_VAULT_PRIVATE_KEY so an existing deployment works without a new
 * secret, but they are separate settings on purpose: the medal vault custodies unclaimed
 * medals, while this one only ever spends SOL on gas and rent. Wanting to fund, rotate or
 * audit those independently is normal.
 *
 * Deliberately not shared with medals.ts's vaultSigner - that one names its own env var in
 * its own error message, and parameterising it would couple two unrelated failure modes.
 */
export const platformSigner = (env: CloudflareBindings) => {
    const secret = env.MINT_VAULT_PRIVATE_KEY || env.MEDAL_VAULT_PRIVATE_KEY
    if (!secret) return null
    try {
        const umi = getUmi(solanaRpc(env))
        const kp = umi.eddsa.createKeypairFromSecretKey(base58.serialize(secret))
        return { umi: umi.use(keypairIdentity(kp)), address: kp.publicKey.toString() }
    } catch (e) {
        console.error('MINT_VAULT_PRIVATE_KEY is not a valid base58 secret key:', e)
        return null
    }
}

// --- deterministic asset address ------------------------------------------------------------

/**
 * Derive the asset keypair for a payment.
 *
 * HMAC rather than a plain hash so the address cannot be predicted by anyone who knows the
 * payment id - a predictable address can be dusted, and an address holding any lamports at
 * all makes create_account fail permanently.
 *
 * MINT_ASSET_SEED is a derivation root, not a rotatable secret. Rotating it while jobs are
 * open makes those jobs underivable; the stored mintAddress check below turns that into a
 * loud stop rather than a second mint.
 */
export const deriveAssetSigner = async (
    umi: ReturnType<typeof getUmi>,
    seedSecret: string,
    paymentId: string,
    seedVersion: number = CURRENT_SEED_VERSION
): Promise<KeypairSigner> => {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(seedSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    )
    const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`v${seedVersion}:${paymentId}`))
    // SHA-256 is 32 bytes, which is exactly an ed25519 seed.
    const kp = umi.eddsa.createKeypairFromSeed(new Uint8Array(mac))
    return createSignerFromKeypair(umi, kp)
}

// --- on-chain state -------------------------------------------------------------------------

export type AssetState =
    | { kind: 'absent' }
    | { kind: 'minted'; owner: string }
    | { kind: 'blocked'; reason: string }

/**
 * What is actually sitting at the derived address.
 *
 * Not a bare "does an account exist" check, which is the trap: Solana's create_account fails
 * if the destination holds ANY lamports, whatever owns it and whatever is in it. So an
 * account existing does not mean the mint succeeded, and treating it that way would mark a
 * dusted job complete while the buyer never receives anything.
 *
 * Three outcomes, three different next steps - which is why this returns a shape rather than
 * a boolean.
 */
export const readAssetState = async (
    umi: ReturnType<typeof getUmi>,
    address: string
): Promise<AssetState> => {
    const account = await umi.rpc.getAccount(publicKey(address))
    if (!account.exists) return { kind: 'absent' }

    if (account.owner.toString() !== MPL_CORE_PROGRAM) {
        return {
            kind: 'blocked',
            reason: `address holds an account owned by ${account.owner.toString()}, not MPL Core`,
        }
    }

    try {
        const asset = await fetchAsset(umi, publicKey(address))
        return { kind: 'minted', owner: asset.owner.toString() }
    } catch (e) {
        return { kind: 'blocked', reason: `account exists but is not a readable Core asset: ${e}` }
    }
}

/**
 * Ask DAS who owns an asset.
 *
 * Returns null - never throws, never guesses - when the RPC is not Helius, when the method is
 * unsupported, or when the indexer has not caught up yet. A null here is "DAS could not tell
 * us", which is a different statement from "the owner is wrong", so the caller falls back to
 * reading the account rather than treating it as a failed mint.
 */
export const verifyOwnershipViaDas = async (
    env: CloudflareBindings,
    assetId: string
): Promise<string | null> => {
    if (!(env.SOLANA_RPC_URL ?? '').includes('helius')) return null
    const result = await rpc<{ ownership?: { owner?: string } }>(env, 'getAsset', [{ id: assetId }])
    return result?.ownership?.owner ?? null
}

/**
 * Send and wait, bounded by the Worker request budget.
 *
 * Same shape as medals.ts's sendWithBoundedConfirm and for the same reason: umi's
 * sendAndConfirm polls past Cloudflare's ceiling. Duplicated rather than imported because
 * that one is not exported, and reaching into medals.ts from the payment path would couple
 * two features that have no other relationship.
 */
const sendWithBoundedConfirm = async (
    env: CloudflareBindings,
    umi: ReturnType<typeof getUmi>,
    tx: Transaction
): Promise<{ signature: string; confirmed: boolean }> => {
    const raw = await umi.rpc.sendTransaction(tx)
    const signature = base58.deserialize(raw)[0]

    for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise((r) => setTimeout(r, 1_500))
        if (await verifySolanaTransaction(env, signature)) return { signature, confirmed: true }
    }
    return { signature, confirmed: false }
}

// --- the job ---------------------------------------------------------------------------------

export type JobOutcome =
    | 'minted'
    | 'already-minted'
    | 'not-claimed'
    | 'retry'
    | 'blocked'
    | 'refunded'
    | 'unconfigured'

/**
 * Roughly what one job costs in subrequests, used to decide whether another one fits in this
 * invocation. Ten on the happy path, seventeen if every confirm poll is needed - this worker
 * budgets against fifty per invocation, the same number admin.ts:556 and index.ts:249 do.
 */
export const SUBREQUESTS_PER_JOB = 17

/**
 * Run one job to completion or to a decision about why it cannot complete.
 *
 * Ordering inside is load-bearing. The claim comes first so nobody else starts. The address
 * is written before the send so a crash mid-flight still knows where to look. The job status
 * moves to MINTED last, after the Nft and Transaction rows exist, so a crash between them
 * leaves work a retry can finish rather than a job that claims to be done.
 */
export const runMintJob = async (
    env: CloudflareBindings,
    connectionString: string,
    jobId: string
): Promise<JobOutcome> => {
    const seedSecret = env.MINT_ASSET_SEED
    if (!seedSecret) {
        console.error('MINT_ASSET_SEED is not configured; refusing to mint')
        return 'unconfigured'
    }
    const vault = platformSigner(env)
    if (!vault) {
        console.error('No mint vault key configured; refusing to mint')
        return 'unconfigured'
    }

    const leaseCutoff = new Date(Date.now() - MINT_LEASE_MS)

    // Claim. PENDING, or a MINTING row whose lease has expired - without the second case an
    // isolate evicted mid-confirm would leave the row stuck in MINTING forever and no sweep
    // would ever look at it again.
    const claimed = await withPrisma(connectionString, async (prisma) => {
        const { count } = await prisma.mintJob.updateMany({
            where: {
                id: jobId,
                OR: [{ status: 'PENDING' }, { status: 'MINTING', lockedAt: { lt: leaseCutoff } }],
            },
            data: { status: 'MINTING', lockedAt: new Date(), attempts: { increment: 1 } },
        })
        if (count === 0) return null
        return prisma.mintJob.findUnique({
            where: { id: jobId },
            include: { payment: { include: { quote: true } } },
        })
    })

    if (!claimed) return 'not-claimed'

    // Checked here, immediately after the claim, rather than in the catch below - because the
    // path most likely to loop does not throw. A mint that is sent but never confirms takes
    // the `retry` branch, which used to skip the cap entirely: an unfunded vault or a stuck
    // chain would re-send every five minutes forever while the buyer stayed charged and no
    // refund ever fired. One guard at the top covers every way out of this function.
    if (claimed.attempts > MAX_MINT_ATTEMPTS) {
        console.error(`[MINTJOB ${jobId}] giving up after ${claimed.attempts} attempts; refunding`)
        await refundJob(
            env,
            connectionString,
            jobId,
            `mint did not complete after ${MAX_MINT_ATTEMPTS} attempts: ${claimed.lastError ?? 'no further detail'}`
        )
        return 'refunded'
    }

    const fail = async (reason: string, terminal: boolean) => {
        await withPrisma(connectionString, (prisma) =>
            prisma.mintJob.update({
                where: { id: jobId },
                data: { status: terminal ? 'BLOCKED' : 'PENDING', lastError: reason.slice(0, 500) },
            })
        )
    }

    try {
        const umi = vault.umi
        const assetSigner = await deriveAssetSigner(
            umi,
            seedSecret,
            claimed.paymentId,
            claimed.seedVersion
        )
        const derived = assetSigner.publicKey.toString()

        // A stored address that disagrees with the derived one means the seed changed under
        // an open job. Minting now would create a SECOND asset for a payment that may already
        // have one, so this stops rather than guessing.
        if (claimed.mintAddress && claimed.mintAddress !== derived) {
            const reason = `derived ${derived} but row holds ${claimed.mintAddress}: MINT_ASSET_SEED changed while this job was open`
            console.error(`[MINTJOB ${jobId}] ${reason}`)
            await fail(reason, true)
            return 'blocked'
        }

        // Written before the send, so a crash between here and confirmation still leaves a
        // record of which account to inspect.
        if (!claimed.mintAddress) {
            await withPrisma(connectionString, (prisma) =>
                prisma.mintJob.update({ where: { id: jobId }, data: { mintAddress: derived } })
            )
        }

        const state = await readAssetState(umi, derived)
        if (state.kind === 'blocked') {
            console.error(`[MINTJOB ${jobId}] ${state.reason}`)
            await fail(state.reason, true)
            return 'blocked'
        }

        let signature = claimed.txSignature ?? null
        let alreadyMinted = false

        if (state.kind === 'minted') {
            // A previous attempt landed. Nothing to send; fall through to recording it.
            alreadyMinted = true
        } else {
            const builder = withPriorityFees(
                umi,
                createV1(umi, {
                    asset: assetSigner,
                    name: claimed.name,
                    uri: claimed.metadataUri,
                    owner: publicKey(claimed.ownerAddress),
                }),
                PRIORITY_MICRO_LAMPORTS,
                COMPUTE_UNITS
            )

            const withBlockhash = await builder.setLatestBlockhash(umi)
            // buildAndSign, not build: createV1 needs the new asset keypair to co-sign
            // alongside the identity.
            const signed = await withBlockhash.buildAndSign(umi)
            const sent = await sendWithBoundedConfirm(env, umi, signed)
            signature = sent.signature

            await withPrisma(connectionString, (prisma) =>
                prisma.mintJob.update({ where: { id: jobId }, data: { txSignature: sent.signature } })
            )

            if (!sent.confirmed) {
                // Sent but not seen to land inside the budget. Deliberately left retryable:
                // the next pass re-derives the same address and readAssetState tells us
                // whether this transaction actually made it.
                const reason = `sent ${sent.signature} but not confirmed within the request budget`
                console.warn(`[MINTJOB ${jobId}] ${reason}`)
                await fail(reason, false)
                return 'retry'
            }
        }

        // Ownership, verified rather than assumed.
        //
        // DAS first, because it is the index the rest of the ecosystem reads - an asset that
        // exists on chain but has not reached the indexer is invisible to wallets, so
        // confirming it there is a stronger statement than reading the account we just wrote.
        // It is a Helius extension though, and the public devnet endpoint does not serve it,
        // so the Core account read is the fallback rather than the exception.
        let owner: string | null = null
        let ownershipSource: string | null = null

        const indexed = await verifyOwnershipViaDas(env, derived)
        if (indexed) {
            owner = indexed
            ownershipSource = 'das'
        } else {
            const after = state.kind === 'minted' ? state : await readAssetState(umi, derived)
            if (after.kind === 'minted') {
                owner = after.owner
                ownershipSource = 'account_read'
            }
        }
        const ownershipVerified = owner === claimed.ownerAddress

        if (!ownershipVerified) {
            console.error(
                `[MINTJOB ${jobId}] ownership check: asset owner is ${owner}, expected ${claimed.ownerAddress}`
            )
        }

        // What the vault actually spent - transaction fee plus the rent it will never see
        // again. Read from the fee payer's balance delta, which is the only figure that
        // means "cost to the platform".
        let actualFeeLamports: bigint | null = null
        if (signature) {
            const cost = await readFeePayerCost(env, signature, vault.address)
            actualFeeLamports = cost?.lamports ?? null
        }

        // Converted at the rate the QUOTE used, not today's. "Estimated vs actual" is only a
        // meaningful comparison if both sides are in the same currency at the same rate;
        // re-converting at a moved rate would report an FX swing as a mint cost overrun.
        let actualFeeMinor: number | null = null
        if (actualFeeLamports !== null) {
            const quoteRate = claimed.payment.quote?.rateScaled ?? null
            if (quoteRate) {
                try {
                    actualFeeMinor = lamportsToEurMinor(actualFeeLamports, quoteRate)
                } catch (e) {
                    console.warn(`[MINTJOB ${jobId}] could not convert actual fee:`, e)
                }
            }
        }

        // Outside the connection: holding a pooled Neon socket open across a remote fetch is
        // how a slow metadata host becomes a database problem. resolveMetadata never throws.
        const meta = await resolveMetadata(env, claimed.metadataUri)

        const assetId = makeAssetId('SOLANA', { mintAddress: derived })

        await withPrisma(connectionString, async (prisma) => {
            const userId = await ensureUser(prisma, 'SOLANA', claimed.ownerAddress)

            // upsert, not create. A crash between this write and the status update below
            // would make every retry throw P2002 on the unique assetId and wedge the job
            // permanently - which is the difference between a retryable job and a lost one.
            const nft = await prisma.nft.upsert({
                where: { assetId },
                create: {
                    chain: 'SOLANA',
                    assetId,
                    mintAddress: derived,
                    name: claimed.name,
                    metadataUri: claimed.metadataUri,
                    ownerAddress: claimed.ownerAddress,
                    creatorAddress: claimed.ownerAddress,
                    imageUrl: meta.imageUrl,
                    animationUrl: meta.animationUrl,
                    description: meta.description,
                    category: meta.category,
                    attributes: meta.attributes ?? undefined,
                    imageOk: meta.imageOk,
                },
                update: { ownerAddress: claimed.ownerAddress },
            })

            if (signature) {
                await prisma.transaction.upsert({
                    where: { txHash: signature },
                    create: await auditedTransactionData({
                        chain: 'SOLANA',
                        kind: 'MINT',
                        status: 'CONFIRMED',
                        userId,
                        walletAddress: claimed.ownerAddress,
                        // The SOL the platform spent, not the EUR the buyer paid. The fiat
                        // side lives on the Payment row, where its currency is not a fact
                        // about a chain.
                        // fromBaseUnits, never Number(lamports) / 1e9: that division is a
                        // float operation and this column is money. It is also the exact
                        // string form Postgres hands back, which is what keeps the row's
                        // own checksum verifying after the round trip.
                        amount:
                            actualFeeLamports === null
                                ? '0'
                                : fromBaseUnits(actualFeeLamports, 'SOLANA'),
                        txHash: signature,
                        assetId,
                        metadata: {
                            source: 'stripe_mint',
                            nftRowId: nft.id,
                            paymentMethod: 'stripe',
                            paymentId: claimed.paymentId,
                            mintJobId: jobId,
                            feePayer: vault.address,
                            mintedAt: new Date().toISOString(),
                        },
                    }),
                    update: { status: 'CONFIRMED' },
                })
            }

            // Last. Everything this job promised now exists.
            await prisma.mintJob.update({
                where: { id: jobId },
                data: {
                    status: 'MINTED',
                    nftId: nft.id,
                    mintAddress: derived,
                    txSignature: signature,
                    actualFeeLamports,
                    actualFeeMinor,
                    ownershipVerified,
                    ownershipSource,
                    lastError: null,
                    lockedAt: null,
                },
            })
        })

        console.log(`[MINTJOB ${jobId}] minted ${derived} for ${claimed.ownerAddress}`)
        return alreadyMinted ? 'already-minted' : 'minted'
    } catch (e: any) {
        const reason = e?.message ?? String(e)
        console.error(`[MINTJOB ${jobId}] failed:`, e)

        // No cap check here: the guard at the top of the next attempt owns that decision, so
        // every retry path - thrown or returned - reaches it the same way.
        await fail(reason, false)
        return 'retry'
    }
}

/**
 * Give the money back for a mint that can never happen.
 *
 * The alternative is a buyer who paid and holds nothing, with no record saying so. Stripe's
 * idempotency key is derived from the payment row, so a sweep racing an admin produces one
 * refund rather than two.
 */
export const refundJob = async (
    env: CloudflareBindings,
    connectionString: string,
    jobId: string,
    reason: string
): Promise<boolean> => {
    const job = await withPrisma(connectionString, (prisma) =>
        prisma.mintJob.findUnique({ where: { id: jobId }, include: { payment: true } })
    )
    if (!job) return false

    const intentId = job.payment.stripePaymentIntentId
    if (!intentId) {
        // Never charged, so there is nothing to give back.
        await withPrisma(connectionString, (prisma) =>
            prisma.mintJob.update({
                where: { id: jobId },
                data: { status: 'FAILED', lastError: reason.slice(0, 500), lockedAt: null },
            })
        )
        return true
    }

    const refund = await createRefund(env, {
        paymentIntentId: intentId,
        paymentRowId: job.paymentId,
        reason: reason.slice(0, 200),
    })

    await withPrisma(connectionString, async (prisma) => {
        await prisma.mintJob.update({
            where: { id: jobId },
            data: {
                status: refund.ok ? 'REFUNDED' : 'FAILED',
                lastError: reason.slice(0, 500),
                lockedAt: null,
            },
        })
        await prisma.payment.update({
            where: { id: job.paymentId },
            data: {
                status: refund.ok ? 'REFUNDED' : 'FAILED',
                stripeRefundId: refund.ok ? refund.data.id : null,
                failureReason: reason.slice(0, 500),
            },
        })
    })

    if (!refund.ok) {
        console.error(`[MINTJOB ${jobId}] refund failed: ${refund.message}`)
    }
    return refund.ok
}

/**
 * Work through whatever is outstanding, within one invocation's budget.
 *
 * Not a fixed batch size. This worker gets fifty subrequests per invocation and a job costs
 * up to seventeen, so the honest ceiling is two or three - and it moves depending on how
 * many confirm polls each mint needs. Both bounds are checked because either one alone
 * eventually kills the invocation mid-mint.
 */
export const sweepMintJobs = async (
    env: CloudflareBindings,
    connectionString: string,
    opts: { maxJobs?: number; budgetMs?: number; subrequestBudget?: number } = {}
): Promise<{ processed: number; outcomes: Record<string, number> }> => {
    const maxJobs = opts.maxJobs ?? 3
    const budgetMs = opts.budgetMs ?? 20_000
    const subrequestBudget = opts.subrequestBudget ?? 45
    const started = Date.now()

    const leaseCutoff = new Date(Date.now() - MINT_LEASE_MS)
    const due = await withPrisma(connectionString, (prisma) =>
        prisma.mintJob.findMany({
            where: {
                OR: [{ status: 'PENDING' }, { status: 'MINTING', lockedAt: { lt: leaseCutoff } }],
            },
            orderBy: { createdAt: 'asc' },
            take: maxJobs,
            select: { id: true },
        })
    )

    const outcomes: Record<string, number> = {}
    let processed = 0
    let used = 2 // the query above, plus its connection

    for (const { id } of due) {
        if (Date.now() - started > budgetMs) {
            console.log('[SWEEP] wall-clock budget reached; remaining jobs wait for the next tick')
            break
        }
        if (used + SUBREQUESTS_PER_JOB > subrequestBudget) {
            console.log('[SWEEP] subrequest budget reached; remaining jobs wait for the next tick')
            break
        }
        const outcome = await runMintJob(env, connectionString, id)
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
        used += SUBREQUESTS_PER_JOB
        processed++
    }

    return { processed, outcomes }
}
