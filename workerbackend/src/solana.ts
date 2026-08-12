// Solana devnet reads and transaction verification. The mirror of evm.ts.
//
// verifySolanaTransaction moved here from webhook.ts, which existed to serve Coinbase Commerce
// webhooks. Commerce shut down 2026-03-31, so that file is gone, but this function is the
// backbone of on-chain payment verification and belongs with the other chain plumbing.

import { solanaRpc, fromBaseUnits } from './chains'

type RpcResult<T> = { result?: T; error?: { message?: string } }

const rpc = async <T>(
    env: CloudflareBindings,
    method: string,
    params: unknown[]
): Promise<T | null> => {
    try {
        const res = await fetch(solanaRpc(env), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        })
        if (!res.ok) {
            console.error(`solana rpc ${method} http ${res.status}`)
            return null
        }
        const body = (await res.json()) as RpcResult<T>
        if (body.error) {
            console.error(`solana rpc ${method} error:`, body.error.message)
            return null
        }
        return body.result ?? null
    } catch (e) {
        console.error(`solana rpc ${method} threw:`, e)
        return null
    }
}

/**
 * True only when the signature names a transaction that landed and did not error.
 *
 * Fails closed in every other case - unset RPC, unreachable node, missing transaction,
 * on-chain error. An optimistic true here would mint or release value for a payment that
 * never settled, which is precisely the v1 bug where a Coinbase outage read as "paid".
 */
export const verifySolanaTransaction = async (
    env: CloudflareBindings,
    signature: string
): Promise<boolean> => {
    // Base58 signatures are 64 bytes: 87-88 chars.
    if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) return false

    const result = await rpc<{ meta?: { err: unknown } }>(env, 'getTransaction', [
        signature,
        { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
    ])
    if (!result?.meta) return false
    return result.meta.err === null
}

export type SolTransfer = { from: string; to: string; lamports: bigint; sol: string }

/**
 * Extract the net SOL movement of a confirmed transaction by diffing pre/post balances.
 *
 * Reading balance deltas rather than decoding instructions means a transfer counts however it
 * was constructed - bare System transfer, CPI, or bundled with other instructions.
 */
export const readSolTransfer = async (
    env: CloudflareBindings,
    signature: string
): Promise<SolTransfer | null> => {
    const tx = await rpc<{
        meta?: { err: unknown; preBalances: number[]; postBalances: number[]; fee: number }
        transaction?: { message?: { accountKeys: string[] } }
    }>(env, 'getTransaction', [
        signature,
        { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
    ])

    if (!tx?.meta || tx.meta.err !== null) return null
    const keys = tx.transaction?.message?.accountKeys
    const { preBalances: pre, postBalances: post, fee } = tx.meta
    if (!keys || !pre || !post || pre.length !== post.length) return null

    let sender = -1
    let recipient = -1
    let moved = 0n

    for (let i = 0; i < keys.length; i++) {
        const delta = BigInt(post[i]) - BigInt(pre[i])
        // The fee payer is index 0, so add the fee back to see what it actually sent.
        const adjusted = i === 0 ? delta - BigInt(fee) : delta
        if (adjusted < 0n && (sender === -1 || -adjusted > moved)) {
            sender = i
            moved = -adjusted
        }
        if (adjusted > 0n && (recipient === -1 || adjusted > BigInt(post[recipient]) - BigInt(pre[recipient]))) {
            recipient = i
        }
    }

    if (sender === -1 || recipient === -1 || moved === 0n) return null
    return {
        from: keys[sender],
        to: keys[recipient],
        lamports: moved,
        sol: fromBaseUnits(moved, 'SOLANA'),
    }
}

/**
 * Verify a signature moved at least `minLamports` to `expectedRecipient`.
 *
 * Used for platform fees: the caller claims they paid, and this checks the chain agrees on
 * both the destination and the amount. Underpaying by a lamport fails.
 */
export const verifySolPayment = async (
    env: CloudflareBindings,
    signature: string,
    expectedRecipient: string,
    minLamports: bigint
): Promise<{ ok: boolean; reason?: string }> => {
    const transfer = await readSolTransfer(env, signature)
    if (!transfer) return { ok: false, reason: 'transaction not found, failed, or moved no SOL' }
    if (transfer.to !== expectedRecipient) {
        return { ok: false, reason: `paid ${transfer.to}, expected ${expectedRecipient}` }
    }
    if (transfer.lamports < minLamports) {
        return { ok: false, reason: `paid ${transfer.lamports} lamports, need ${minLamports}` }
    }
    return { ok: true }
}

/** Lamport balance of an address, or null when the RPC is unreachable. */
export const getBalance = async (
    env: CloudflareBindings,
    address: string
): Promise<bigint | null> => {
    const r = await rpc<{ value: number }>(env, 'getBalance', [address])
    return r ? BigInt(r.value) : null
}
