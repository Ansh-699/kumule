/**
 * Audit logging and transaction integrity checksums.
 *
 * Ported to the v2 Transaction model: transactionId became txHash (the natural unique key
 * on-chain), transactionType became kind, network became chain, and metadata is real Json
 * rather than a stringified blob. The nftId column is gone - Transaction no longer points at
 * an Nft row, so an asset reference lives in metadata.assetId.
 */

import { Prisma } from '@prisma/client'
import { withPrisma } from './db'
import { Chain, CHAIN_CONFIG } from './chains'

export interface AuditLogEntry {
    action: string
    actor: string
    target?: string
    transactionHash?: string
    checksum?: string
    metadata?: Record<string, any>
    timestamp: Date
    success: boolean
    errorMessage?: string
}

export async function generateChecksum(data: string): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
}

/**
 * Checksum over the parameters that define a transaction.
 *
 * `amount` is a decimal string, never a number: routing money through a float would make the
 * checksum depend on IEEE-754 rounding, so a legitimate record could fail its own verification.
 */
export async function createTransactionChecksum(params: {
    type: string
    actor: string
    target?: string
    amount?: string
    chain?: Chain
    assetId?: string
    timestamp: number
}): Promise<string> {
    return generateChecksum(
        JSON.stringify({
            type: params.type,
            actor: params.actor,
            target: params.target,
            amount: params.amount,
            chain: params.chain,
            assetId: params.assetId,
            timestamp: params.timestamp,
        })
    )
}

/**
 * The single definition of what a Transaction row's checksum covers.
 *
 * Writer and reader have to feed createTransactionChecksum byte-identical inputs or every
 * verification fails as a false tamper alarm. Keeping the mapping in one place is the whole
 * point: when they were written out separately at each call site, they drifted - and because
 * nothing wrote a checksum at all, `GET /api/admin/audit/:identifier` could only ever answer
 * "Transaction missing checksum data".
 *
 * Takes the row as stored, so the reader can pass a Prisma record almost verbatim.
 */
export type ChecksumSubject = {
    kind: string
    walletAddress: string | null
    /** Decimal string as stored. Never a number - see createTransactionChecksum. */
    amount: string | null
    chain: Chain
    assetId?: string | null
    timestamp: number
}

export const checksumTransaction = (subject: ChecksumSubject): Promise<string> =>
    createTransactionChecksum({
        type: subject.kind,
        actor: subject.walletAddress || '',
        amount: subject.amount ?? undefined,
        chain: subject.chain,
        assetId: subject.assetId ?? undefined,
        timestamp: subject.timestamp,
    })

export function logAudit(entry: AuditLogEntry): void {
    const logData = { ...entry, timestamp: entry.timestamp.toISOString(), _audit: true }
    if (entry.success) console.log('[AUDIT]', JSON.stringify(logData))
    else console.error('[AUDIT:ERROR]', JSON.stringify(logData))
}

/** What a caller knows about a transaction. Everything else is derived. */
export type AuditedTransaction = {
    chain: Chain
    kind: string
    status: string
    userId?: string | null
    walletAddress?: string | null
    /** Decimal string. Kept as a string end to end so no float touches money. */
    amount?: string | null
    txHash?: string | null
    assetId?: string | null
    metadata?: Record<string, any>
}

/**
 * Build the `data` for a Transaction row with its integrity checksum already in metadata.
 *
 * Every writer goes through this. `verifyTransactionChecksum` recomputes the checksum from the
 * stored row, so a row written without one can only ever answer "Transaction missing checksum
 * data" - and only mint.ts wrote one, which left `GET /api/admin/audit/:identifier` useless for
 * purchases, transfers, burns, medal claims and settlements: five of the six kinds this
 * marketplace records.
 *
 * It returns the row rather than writing it because every caller is already inside a
 * `withPrisma` block, usually alongside the writes it has to stay consistent with. Opening a
 * second connection to append the audit row would put it outside that transaction.
 */
export const auditedTransactionData = async (
    tx: AuditedTransaction
): Promise<Prisma.TransactionUncheckedCreateInput> => {
    const timestamp = Date.now()
    // Canonicalised through Decimal before it is hashed, because that is the form it comes back
    // in: Postgres stores 1.10 as 1.1, so checksumming the caller's spelling would make the row
    // fail its own verification and report a tamper that never happened.
    const amount = tx.amount == null ? null : new Prisma.Decimal(tx.amount).toString()
    const assetId = tx.assetId ?? null
    const walletAddress = tx.walletAddress ?? null

    const checksum = await checksumTransaction({
        kind: tx.kind,
        walletAddress,
        amount,
        chain: tx.chain,
        assetId,
        timestamp,
    })

    return {
        chain: tx.chain,
        kind: tx.kind,
        status: tx.status,
        userId: tx.userId ?? null,
        walletAddress,
        amount,
        // Derived, never passed in: the currency of a row is a fact about its chain, and letting
        // call sites spell it out is how a SOL row ends up labelled ETH.
        currency: CHAIN_CONFIG[tx.chain].currency,
        txHash: tx.txHash ?? null,
        metadata: {
            ...tx.metadata,
            // verifyTransactionChecksum reads the asset back out of metadata, so this key is
            // part of the checksum contract rather than decoration.
            assetId,
            _checksum: checksum,
            _timestamp: timestamp,
            _version: '2.0',
        },
    }
}

/**
 * Recompute a stored transaction's checksum and compare.
 *
 * `identifier` may be a tx hash or a row id: callers hold whichever they were given, and
 * making them guess would just push the same branch outward.
 */
export async function verifyTransactionChecksum(
    connectionString: string,
    identifier: string
): Promise<{ valid: boolean; message: string }> {
    try {
        const record = await withPrisma(connectionString, async (prisma) => {
            const byHash = await prisma.transaction.findUnique({ where: { txHash: identifier } })
            if (byHash) return byHash
            return prisma.transaction.findUnique({ where: { id: identifier } })
        })

        if (!record) return { valid: false, message: 'Transaction not found' }

        const metadata = (
            typeof record.metadata === 'string' ? JSON.parse(record.metadata) : record.metadata
        ) as Record<string, any> | null

        if (!metadata?._checksum || !metadata?._timestamp) {
            return { valid: false, message: 'Transaction missing checksum data' }
        }

        const expected = await checksumTransaction({
            kind: record.kind,
            walletAddress: record.walletAddress,
            // toString() on Decimal, not Number(): the checksum must not depend on float rounding.
            amount: record.amount?.toString() ?? null,
            chain: record.chain as Chain,
            assetId: metadata.assetId,
            timestamp: metadata._timestamp,
        })

        return expected === metadata._checksum
            ? { valid: true, message: 'Checksum verified' }
            : { valid: false, message: 'Checksum mismatch - transaction may have been tampered with' }
    } catch (error) {
        return { valid: false, message: `Verification failed: ${error}` }
    }
}

export function logBlockchainTransaction(params: {
    action: string
    walletAddress: string
    assetId?: string
    escrowAddress?: string
    transactionBase64?: string
    success: boolean
    error?: string
}): void {
    logAudit({
        action: `blockchain_${params.action}`,
        actor: params.walletAddress,
        target: params.assetId,
        metadata: {
            escrowAddress: params.escrowAddress,
            hasTransaction: !!params.transactionBase64,
        },
        timestamp: new Date(),
        success: params.success,
        errorMessage: params.error,
    })
}

export type SecurityEventType =
    | 'duplicate_mint_attempt'
    | 'invalid_signature'
    | 'rate_limit_exceeded'
    | 'unauthorized_access'
    | 'suspicious_activity'

export function logSecurityEvent(
    eventType: SecurityEventType,
    details: {
        actor: string
        target?: string
        ipAddress?: string
        userAgent?: string
        metadata?: Record<string, any>
    }
): void {
    console.warn(
        '[SECURITY]',
        JSON.stringify({ eventType, ...details, timestamp: new Date().toISOString(), _security: true })
    )
}
