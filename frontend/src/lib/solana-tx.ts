// Signing and sending the unsigned transactions the backend returns.
//
// The backend builds with umi, and umi serializes to the *versioned* wire format. Passing that
// to web3.js `Transaction.from()` throws:
//
//   "Versioned messages must be deserialized with VersionedMessage.deserialize()"
//
// which is exactly the error the Create page hit. Three call sites had each written the same
// wrong deserialization, so this module is the single correct path they all use.

import {
    Connection,
    Transaction,
    VersionedTransaction,
    type TransactionSignature,
} from '@solana/web3.js'

export const SOLANA_RPC =
    (import.meta.env.VITE_SOLANA_RPC as string | undefined) || 'https://api.devnet.solana.com'

export const solanaConnection = () => new Connection(SOLANA_RPC, 'confirmed')

const fromBase64 = (b64: string): Uint8Array =>
    Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

/**
 * Decode a base64 transaction, versioned or legacy.
 *
 * Versioned is tried first because that is what umi emits. The legacy branch exists so a
 * hand-built `Transaction` from any other code path still works rather than failing obscurely.
 */
export const deserializeTransaction = (base64: string): Transaction | VersionedTransaction => {
    const bytes = fromBase64(base64)
    try {
        return VersionedTransaction.deserialize(bytes)
    } catch {
        return Transaction.from(bytes)
    }
}

export type SignAndSendResult = { signature: TransactionSignature }

type SignerLike = {
    signTransaction?: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>
}

/**
 * Sign with the connected wallet, send, and wait for confirmation.
 *
 * Throws when the transaction lands but errored on chain: `sendRawTransaction` resolving only
 * means the node accepted it, not that it succeeded, and treating that as success is how a UI
 * reports a mint that never happened.
 */
export const signAndSend = async (
    wallet: SignerLike,
    base64: string
): Promise<SignAndSendResult> => {
    if (!wallet.signTransaction) {
        throw new Error('This wallet cannot sign transactions')
    }

    const tx = deserializeTransaction(base64)
    const signed = await wallet.signTransaction(tx)
    const connection = solanaConnection()

    const signature = await connection.sendRawTransaction(signed.serialize(), {
        // The backend already simulated where it could; skipping preflight avoids a second
        // round trip and a duplicate failure mode with a less useful message.
        skipPreflight: false,
        maxRetries: 3,
    })

    const latest = await connection.getLatestBlockhash('confirmed')
    const result = await connection.confirmTransaction(
        {
            signature,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        'confirmed'
    )

    if (result.value.err) {
        throw new Error(`Transaction failed on chain: ${JSON.stringify(result.value.err)}`)
    }

    return { signature }
}

/** True when the wallet reported the user declining, rather than an actual failure. */
export const isUserRejection = (e: unknown): boolean => {
    const msg = (e as { message?: string })?.message ?? ''
    const code = (e as { code?: number })?.code
    return code === 4001 || /reject|denied|cancel|user closed/i.test(msg)
}

/**
 * A readable message for a failed request.
 *
 * `fetch` throws a bare TypeError for anything network-level, which surfaces as the useless
 * "Failed to fetch". The usual cause in this app is a browser shield or content blocker
 * refusing the cross-origin call to the API, so say that instead of leaving the user guessing.
 */
export const describeError = (e: unknown): string => {
    if (isUserRejection(e)) return 'You cancelled the transaction'

    const msg = (e as { shortMessage?: string; message?: string })?.shortMessage
        ?? (e as { message?: string })?.message
        ?? String(e)

    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
        return 'Could not reach the API. A browser shield, ad blocker or privacy extension is ' +
            'usually the cause - the app and the API are on different subdomains, which some ' +
            'blockers treat as cross-site. Try disabling shields for this site.'
    }
    return msg
}
