// Solana devnet reads and transaction verification. The mirror of evm.ts.
//
// verifySolanaTransaction moved here from webhook.ts, which existed to serve Coinbase Commerce
// webhooks. Commerce shut down 2026-03-31, so that file is gone, but this function is the
// backbone of on-chain payment verification and belongs with the other chain plumbing.

import { solanaRpcChain, fromBaseUnits } from './chains'

type RpcResult<T> = { result?: T; error?: { message?: string } }

/**
 * Raw Solana JSON-RPC. Exported because the fee quote and the mint runner both need to
 * reach methods this module does not wrap; copying it would fork the error handling that
 * makes every read here fail closed.
 */
export const rpc = async <T>(
    env: CloudflareBindings,
    method: string,
    params: unknown[]
): Promise<T | null> => {
    // Tried in order rather than against one endpoint, because in practice they fail: a
    // provider runs out of credits (429) or refuses Cloudflare egress outright (403), and a
    // single dead endpoint is enough to leave a paid mint unfulfilled.
    for (const endpoint of solanaRpcChain(env)) {
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            })
            if (!res.ok) {
                console.warn(`solana rpc ${method} http ${res.status} from ${new URL(endpoint).host}`)
                continue
            }
            const body = (await res.json()) as RpcResult<T>
            if (body.error) {
                // A JSON-RPC error can mean either "this node will not serve you" or "the
                // answer is genuinely an error". Rate limiting and auth are worth retrying
                // elsewhere; anything else is the node answering the question, so take it.
                const message = body.error.message ?? ''
                const transport = /rate|limit|429|403|forbidden|blocked|unauthor|credit|usage/i.test(message)
                console.warn(`solana rpc ${method} error from ${new URL(endpoint).host}: ${message}`)
                if (transport) continue
                return null
            }
            return body.result ?? null
        } catch (e) {
            console.warn(`solana rpc ${method} threw against ${new URL(endpoint).host}:`, e)
        }
    }
    console.error(`solana rpc ${method}: every endpoint failed`)
    return null
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

/**
 * Lamport balance of an address, or null when the RPC is unreachable.
 *
 * At the 'confirmed' commitment, deliberately, and not the RPC default of 'finalized'.
 * Finalization trails confirmation by roughly fifteen seconds, so the default reported a
 * freshly funded wallet as EMPTY - which mattered because checkout gates on this: topping up
 * the mint vault and immediately taking an order got "Minting is temporarily unavailable",
 * and a vault whose balance had just moved could refuse perfectly fundable orders. Every other
 * read in this codebase is already at 'confirmed', including umi's own client.
 */
export const getBalance = async (
    env: CloudflareBindings,
    address: string
): Promise<bigint | null> => {
    const r = await rpc<{ value: number }>(env, 'getBalance', [address, { commitment: 'confirmed' }])
    return r ? BigInt(r.value) : null
}

/**
 * What a transaction actually cost its fee payer, in lamports.
 *
 * Deliberately not readSolTransfer: that function finds the largest balance mover, which
 * for a mint is the new asset account receiving its rent, not the wallet that paid. This
 * one reads index 0 - Solana's fee payer is always the first account key - and refuses to
 * answer if that key is not the wallet we expected, rather than reporting some other
 * account's delta as our cost.
 *
 * The delta covers the signature fee, any priority fee, and the rent deposited into the
 * new account. That total is what "actual fee paid" has to mean for a platform-paid mint:
 * the rent is gone from the vault for good, because the asset belongs to the buyer.
 */
export const readFeePayerCost = async (
    env: CloudflareBindings,
    signature: string,
    expectedFeePayer: string
): Promise<{ lamports: bigint; slot: number | null } | null> => {
    const tx = await rpc<{
        slot?: number
        meta?: { err: unknown; preBalances?: number[]; postBalances?: number[] } | null
        transaction?: { message?: { accountKeys?: unknown[] } }
    }>(env, 'getTransaction', [
        signature,
        { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
    ])

    if (!tx?.meta || tx.meta.err !== null) return null

    const { preBalances, postBalances } = tx.meta
    if (!preBalances?.length || !postBalances?.length) return null

    // accountKeys entries are strings for legacy messages and objects once jsonParsed or a
    // versioned message is involved; normalise before comparing.
    const first = tx.transaction?.message?.accountKeys?.[0]
    const feePayer =
        typeof first === 'string' ? first : (first as { pubkey?: string } | undefined)?.pubkey
    if (feePayer !== expectedFeePayer) {
        console.error(`fee payer mismatch: tx paid by ${feePayer}, expected ${expectedFeePayer}`)
        return null
    }

    const spent = BigInt(preBalances[0]) - BigInt(postBalances[0])
    // A negative delta means the payer came out ahead, which cannot happen for a mint and
    // means we are reading the wrong transaction.
    if (spent < 0n) return null
    return { lamports: spent, slot: tx.slot ?? null }
}

/** Rent-exempt minimum for an account of `bytes`, straight from the cluster. */
export const rentExemptLamports = async (
    env: CloudflareBindings,
    bytes: number
): Promise<bigint | null> => {
    const r = await rpc<number>(env, 'getMinimumBalanceForRentExemption', [bytes])
    return typeof r === 'number' ? BigInt(r) : null
}
