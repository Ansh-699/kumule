/**
 * Security Audit Logging Module
 * Provides transaction checksum verification and audit trail logging
 */

import { withPrisma, getConnectionString } from './db'

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

/**
 * Generate SHA-256 checksum for transaction data
 */
export async function generateChecksum(data: string): Promise<string> {
    const encoder = new TextEncoder()
    const dataBuffer = encoder.encode(data)
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Create checksum for transaction verification
 * Includes key transaction parameters for integrity checking
 */
export async function createTransactionChecksum(params: {
    type: string
    actor: string
    target?: string
    amount?: number
    assetId?: string
    timestamp: number
}): Promise<string> {
    const data = JSON.stringify({
        type: params.type,
        actor: params.actor,
        target: params.target,
        amount: params.amount,
        assetId: params.assetId,
        timestamp: params.timestamp
    })
    return generateChecksum(data)
}

/**
 * Log audit entry to console with structured format
 * Can be extended to log to external services
 */
export function logAudit(entry: AuditLogEntry): void {
    const logData = {
        ...entry,
        timestamp: entry.timestamp.toISOString(),
        _audit: true
    }
    
    if (entry.success) {
        console.log('[AUDIT]', JSON.stringify(logData))
    } else {
        console.error('[AUDIT:ERROR]', JSON.stringify(logData))
    }
}

/**
 * Record transaction in database with checksum for verification
 */
export async function recordAuditedTransaction(
    connectionString: string,
    params: {
        transactionId: string
        userId: string
        action: string
        amount?: number
        nftId?: string | null
        walletAddress: string
        txHash?: string
        metadata?: Record<string, any>
    }
): Promise<{ success: boolean; checksum: string }> {
    const timestamp = Date.now()
    const checksum = await createTransactionChecksum({
        type: params.action,
        actor: params.walletAddress,
        amount: params.amount,
        timestamp
    })

    const auditMetadata = {
        ...params.metadata,
        _checksum: checksum,
        _timestamp: timestamp,
        _version: '1.0'
    }

    try {
        await withPrisma(connectionString, async (prisma) => {
            await prisma.transaction.create({
                data: {
                    transactionId: params.transactionId,
                    userId: params.userId,
                    amount: params.amount || 0,
                    nftId: params.nftId || null,
                    transactionType: params.action,
                    status: 'COMPLETED',
                    walletAddress: params.walletAddress,
                    txHash: params.txHash || null,
                    currency: 'SOL',
                    network: 'solana',
                    metadata: JSON.stringify(auditMetadata)
                } as any
            })
        })

        logAudit({
            action: params.action,
            actor: params.walletAddress,
            target: params.nftId || undefined,
            transactionHash: params.txHash,
            checksum,
            metadata: params.metadata,
            timestamp: new Date(timestamp),
            success: true
        })

        return { success: true, checksum }
    } catch (error) {
        logAudit({
            action: params.action,
            actor: params.walletAddress,
            target: params.nftId || undefined,
            checksum,
            metadata: params.metadata,
            timestamp: new Date(timestamp),
            success: false,
            errorMessage: error instanceof Error ? error.message : String(error)
        })

        return { success: false, checksum }
    }
}

/**
 * Verify transaction checksum matches stored value
 */
export async function verifyTransactionChecksum(
    connectionString: string,
    transactionId: string
): Promise<{ valid: boolean; message: string }> {
    try {
        const result = await withPrisma(connectionString, async (prisma) => {
            const transaction = await prisma.transaction.findUnique({
                where: { transactionId }
            })
            return transaction
        })

        if (!result) {
            return { valid: false, message: 'Transaction not found' }
        }

        const metadata = result.metadata ? JSON.parse(result.metadata as string) : {}
        
        if (!metadata._checksum || !metadata._timestamp) {
            return { valid: false, message: 'Transaction missing checksum data' }
        }

        const expectedChecksum = await createTransactionChecksum({
            type: result.transactionType,
            actor: result.walletAddress || '',
            amount: Number(result.amount),
            timestamp: metadata._timestamp
        })

        if (expectedChecksum === metadata._checksum) {
            return { valid: true, message: 'Checksum verified' }
        }

        return { valid: false, message: 'Checksum mismatch - transaction may have been tampered' }
    } catch (error) {
        return { valid: false, message: `Verification failed: ${error}` }
    }
}

/**
 * Log blockchain transaction submission
 */
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
            hasTransaction: !!params.transactionBase64
        },
        timestamp: new Date(),
        success: params.success,
        errorMessage: params.error
    })
}

/**
 * Security event types for rate limiting and monitoring
 */
export type SecurityEventType = 
    | 'duplicate_mint_attempt'
    | 'invalid_signature'
    | 'rate_limit_exceeded'
    | 'unauthorized_access'
    | 'suspicious_activity'

/**
 * Log security events for monitoring
 */
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
    console.warn('[SECURITY]', JSON.stringify({
        eventType,
        ...details,
        timestamp: new Date().toISOString(),
        _security: true
    }))
}
