/**
 * Audit logging and transaction integrity checksums.
 *
 * Ported to the v2 Transaction model: transactionId became txHash (the natural unique key
 * on-chain), transactionType became kind, network became chain, and metadata is real Json
 * rather than a stringified blob. The nftId column is gone - Transaction no longer points at
 * an Nft row, so an asset reference lives in metadata.assetId.
 */

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

export function logAudit(entry: AuditLogEntry): void {
    const logData = { ...entry, timestamp: entry.timestamp.toISOString(), _audit: true }
    if (entry.success) console.log('[AUDIT]', JSON.stringify(logData))
    else console.error('[AUDIT:ERROR]', JSON.stringify(logData))
}

/**
 * Write a Transaction row with an integrity checksum in its metadata.
 *
 * A failure here is logged but never thrown: audit bookkeeping must not roll back the
 * on-chain action it is describing, which has already happened.
 */
export async function recordAuditedTransaction(
    connectionString: string,
    params: {
        chain: Chain
        kind: string
        userId?: string | null
        walletAddress: string
        /** Decimal string. Kept as a string end to end so no float touches money. */
        amount?: string
        assetId?: string | null
        txHash?: string | null
        status?: string
        metadata?: Record<string, any>
    }
): Promise<{ success: boolean; checksum: string }> {
    const timestamp = Date.now()
    const checksum = await createTransactionChecksum({
        type: params.kind,
        actor: params.walletAddress,
        amount: params.amount,
        chain: params.chain,
        assetId: params.assetId ?? undefined,
        timestamp,
    })

    const auditMetadata = {
        ...params.metadata,
        assetId: params.assetId ?? null,
        _checksum: checksum,
        _timestamp: timestamp,
        _version: '2.0',
    }

    try {
        await withPrisma(connectionString, async (prisma) => {
            await prisma.transaction.create({
                data: {
                    chain: params.chain,
                    kind: params.kind,
                    status: params.status ?? 'CONFIRMED',
                    userId: params.userId ?? null,
                    walletAddress: params.walletAddress,
                    amount: params.amount ?? null,
                    currency: CHAIN_CONFIG[params.chain].currency,
                    txHash: params.txHash ?? null,
                    metadata: auditMetadata,
                },
            })
        })

        logAudit({
            action: params.kind,
            actor: params.walletAddress,
            target: params.assetId ?? undefined,
            transactionHash: params.txHash ?? undefined,
            checksum,
            metadata: params.metadata,
            timestamp: new Date(timestamp),
            success: true,
        })
        return { success: true, checksum }
    } catch (error) {
        logAudit({
            action: params.kind,
            actor: params.walletAddress,
            target: params.assetId ?? undefined,
            checksum,
            metadata: params.metadata,
            timestamp: new Date(timestamp),
            success: false,
            errorMessage: error instanceof Error ? error.message : String(error),
        })
        return { success: false, checksum }
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

        const expected = await createTransactionChecksum({
            type: record.kind,
            actor: record.walletAddress || '',
            // toString() on Decimal, not Number(): the checksum must not depend on float rounding.
            amount: record.amount?.toString(),
            chain: record.chain as Chain,
            assetId: metadata.assetId ?? undefined,
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
