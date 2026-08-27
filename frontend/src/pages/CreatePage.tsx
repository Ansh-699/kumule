import { useEffect, useMemo, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useAccount, useWriteContract, usePublicClient } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { Upload, Loader2, CheckCircle2, AlertCircle, ExternalLink, CreditCard } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api, type Chain, type Category, type PriceBreakdown as Breakdown } from '@/lib/api'
import { CHAIN_UI, CATEGORIES } from '@/lib/chain-ui'
import { ChainMark } from '@/components/ChainBadge'
import { NFT_ABI } from '@/lib/evm-abi'
import { describeError, signAndSend } from '@/lib/solana-tx'
import { ConnectForChain } from '@/components/ConnectForChain'
import { PriceBreakdown } from '@/components/PriceBreakdown'

/**
 * Minting.
 *
 * Two payment models live in this one form, which is a product decision rather than an
 * accident, so the copy says so plainly rather than letting someone discover it at the
 * payment step:
 *
 *   Solana  - you pay by card. Kumele's wallet signs the mint and pays the network cost,
 *             and the estimated blockchain fee is a line on the invoice.
 *   Base    - you sign and pay your own gas, as before.
 *
 * The image goes to R2 first, then metadata JSON referencing it, and only then is anything
 * paid for or signed. That ordering means a token is never created pointing at a URI that
 * does not resolve - the v1 failure that left 152 unrenderable NFTs.
 *
 * On the Solana path the wallet is connected for its ADDRESS only. It never signs: the mint
 * happens on the server after Stripe confirms the payment, so the buyer may well have closed
 * the tab by then.
 */

const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined

// Module scope: loadStripe injects a script tag, and calling it per render would add one per
// keystroke.
// Resolved to null rather than left rejecting. react-stripe-js consumes this promise with a
// bare .then() and no .catch(), so a blocked js.stripe.com - an ad blocker, a strict CSP, a
// flaky network - left <Elements> permanently unpopulated: the pay button stayed disabled with
// no message and no explanation. Null takes the same branch as "not configured", which already
// says something useful.
const stripePromise = PUBLISHABLE_KEY
    ? loadStripe(PUBLISHABLE_KEY).catch((e) => {
        console.error('stripe.js failed to load:', e)
        return null
    })
    : null

type State =
    | { kind: 'idle' }
    | { kind: 'busy'; step: string }
    | {
        kind: 'checkout'
        clientSecret: string
        paymentId: string
        breakdown: Breakdown
        feeLabel: string
        feeNote: string
    }
    | { kind: 'minting'; paymentId: string; note: string }
    | { kind: 'done'; assetId: string; explorerUrl?: string }
    // paymentId is present when a PaymentIntent already exists for this attempt. It is what
    // stops the form re-arming: without it, any post-payment error dropped the buyer back on
    // a live "Continue to payment" button with the same file and name still filled in, and
    // pressing it created a SECOND PaymentIntent for the same mint.
    | { kind: 'error'; message: string; paymentId?: string }

/**
 * The card form, and the wait for the chain afterwards.
 *
 * Split out because useStripe and useElements only work inside <Elements>. Confirmation uses
 * redirect: 'if_required' - the intent is created with card as the only payment method, so no
 * redirect-based method is ever offered and there is no return page to build.
 */
const CheckoutForm = ({
    paymentId,
    onMinted,
    onFailed,
}: {
    paymentId: string
    onMinted: (assetId: string, signature: string | null) => void
    onFailed: (message: string) => void
}) => {
    const stripe = useStripe()
    const elements = useElements()
    const [submitting, setSubmitting] = useState(false)
    const [waiting, setWaiting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Poll only once the card has cleared. The mint runs server-side, usually within seconds
    // via the webhook, and within five minutes via the cron sweep if that misses.
    useEffect(() => {
        if (!waiting) return
        let cancelled = false
        const started = Date.now()

        const tick = async () => {
            if (cancelled) return
            try {
                const status = await api.payment(paymentId)
                const mint = status.mint
                if (mint?.status === 'MINTED' && mint.assetId) {
                    onMinted(mint.assetId, mint.txSignature)
                    return
                }
                if (mint && ['FAILED', 'BLOCKED', 'REFUNDED'].includes(mint.status)) {
                    onFailed(
                        mint.status === 'REFUNDED'
                            ? 'The mint could not be completed and your payment has been refunded.'
                            : 'The mint could not be completed. Support has been notified and you will be refunded.'
                    )
                    return
                }
            } catch {
                // A failed poll is not a failed mint; keep waiting.
            }
            // Give up watching after five minutes. The payment is safe either way - the sweep
            // keeps retrying server-side - so this only stops the spinner, never the mint.
            if (Date.now() - started > 5 * 60_000) {
                onFailed(
                    'Your payment went through and the NFT is still being minted. ' +
                    'It will appear in your wallet shortly.'
                )
                return
            }
            if (!cancelled) setTimeout(tick, 2_000)
        }

        const id = setTimeout(tick, 1_500)
        return () => {
            cancelled = true
            clearTimeout(id)
        }
    }, [waiting, paymentId, onMinted, onFailed])

    const pay = async () => {
        if (!stripe || !elements) return
        setSubmitting(true)
        setError(null)
        const { error: stripeError } = await stripe.confirmPayment({
            elements,
            redirect: 'if_required',
        })
        setSubmitting(false)
        if (stripeError) {
            setError(stripeError.message ?? 'The payment could not be completed')
            return
        }
        setWaiting(true)
    }

    if (waiting) {
        return (
            <div className="flex items-center gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500/[0.07] p-3.5 text-sm text-white" role="status">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-300" />
                Payment received. Minting your NFT on Solana…
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <PaymentElement />
            {error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.07] p-3.5 text-sm text-white" role="status">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                    {error}
                </div>
            )}
            <button
                onClick={pay}
                disabled={!stripe || submitting}
                className="w-full rounded-xl bg-indigo-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:bg-white/[0.05] disabled:text-white/40"
            >
                {submitting ? 'Processing…' : 'Pay and mint'}
            </button>
        </div>
    )
}

export const CreatePage = () => {
    const [chain, setChain] = useState<Chain>('SOLANA')
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [category, setCategory] = useState<Category>('ART')
    const [file, setFile] = useState<File | null>(null)
    const [preview, setPreview] = useState<string | null>(null)
    const [state, setState] = useState<State>({ kind: 'idle' })

    const solana = useWallet()
    const evm = useAccount()
    const { writeContractAsync } = useWriteContract()
    const publicClient = usePublicClient()
    const { data: contracts } = useQuery({
        queryKey: ['evm-contracts'],
        queryFn: () => api.evmContracts(),
        enabled: chain === 'ETHEREUM',
    })

    // Which rails the backend says are actually live. Asking rather than assuming is what
    // lets this page be deployed before Stripe is configured: a build that always routed
    // Solana through a card would have broken minting the moment it shipped, because the
    // worker answers 503 without a key.
    const { data: chainInfo } = useQuery({
        queryKey: ['chains'],
        queryFn: () => api.chains(),
        staleTime: 5 * 60_000,
    })
    // Three states, not two. `?? false` folded "we have not heard back yet" into "both rails
    // are switched off", so a single failed /api/chains call disabled minting AND told the
    // user it was paused on purpose - a deliberate-sounding message for a network blip, with
    // no retry and nothing to click.
    const featuresKnown = chainInfo != null
    const stripeLive = chainInfo?.features?.stripePayments ?? false
    const walletMintLive = chainInfo?.features?.directCrypto ?? false

    const address = chain === 'SOLANA' ? solana.publicKey?.toBase58() : evm.address
    const ui = CHAIN_UI[chain]
    // Card is the intended path for Solana, but only where it can actually work. Where it
    // cannot and the wallet route is still open, mint the old way rather than dead-end.
    const payByCard = chain === 'SOLANA' && stripeLive
    const solanaUnavailable = featuresKnown && chain === 'SOLANA' && !stripeLive && !walletMintLive

    const pickFile = (f: File | null) => {
        setFile(f)
        setPreview(f ? URL.createObjectURL(f) : null)
    }

    /** Upload the artwork and its metadata. Shared by both payment models. */
    const publishMetadata = async () => {
        setState({ kind: 'busy', step: 'Uploading image…' })
        const { url: imageUrl } = await api.uploadImage(file!)
        setState({ kind: 'busy', step: 'Uploading metadata…' })
        const { url: metadataUri } = await api.uploadMetadata({
            name,
            description,
            image: imageUrl,
            attributes: [{ trait_type: 'Category', value: category }],
        })
        return metadataUri
    }

    const start = async () => {
        if (!file || !name || !address) return
        try {
            const metadataUri = await publishMetadata()

            if (chain === 'ETHEREUM') {
                if (!contracts) throw new Error('Contract addresses unavailable')
                if (!publicClient) throw new Error('No Base Sepolia connection')

                setState({ kind: 'busy', step: 'Confirm the mint in your wallet…' })
                const hash = await writeContractAsync({
                    address: contracts.nft as `0x${string}`,
                    abi: NFT_ABI,
                    functionName: 'mint',
                    args: [evm.address!, metadataUri],
                })

                // writeContractAsync resolves on submission, so this used to report "Minted"
                // for a transaction that had not been mined and could still revert.
                setState({ kind: 'busy', step: 'Waiting for confirmation on Base Sepolia…' })
                const receipt = await publicClient.waitForTransactionReceipt({ hash })
                if (receipt.status !== 'success') throw new Error('The mint reverted on chain')

                // Nothing on the backend signs EVM transactions, so without this the token
                // existed on chain and never appeared anywhere on the site.
                setState({ kind: 'busy', step: 'Publishing to the marketplace…' })
                const indexed = await api.evmIndexToken(hash)

                setState({ kind: 'done', assetId: indexed.assetId, explorerUrl: ui.explorerTx(hash) })
                return
            }

            if (!payByCard) {
                // Card payments are not configured, so mint the way this app always did:
                // the backend builds an unsigned transaction and the wallet pays its own gas.
                setState({ kind: 'busy', step: 'Building the mint transaction…' })
                const { transaction, mint: mintAddress } = await api.solanaMint({
                    uri: metadataUri, name, owner: address,
                })
                setState({ kind: 'busy', step: 'Approve the mint in your wallet…' })
                const { signature } = await signAndSend(solana, transaction)
                setState({ kind: 'done', assetId: mintAddress, explorerUrl: ui.explorerTx(signature) })
                return
            }

            // Solana: priced, then paid for by card. Nothing is minted until Stripe confirms.
            setState({ kind: 'busy', step: 'Pricing the mint…' })
            // The metadata is already uploaded, so the exact on-chain size is known and the
            // quote can price this asset instead of the largest one it might have been.
            const quote = await api.feeQuote({
                operation: 'nft_mint', chain: 'solana', quantity: 1,
                name, uri: metadataUri,
            })

            setState({ kind: 'busy', step: 'Preparing checkout…' })
            const intent = await api.createPaymentIntent({
                quoteId: quote.quote_id,
                ownerAddress: address,
                name,
                metadataUri,
            })

            setState({
                kind: 'checkout',
                clientSecret: intent.clientSecret,
                paymentId: intent.paymentId,
                breakdown: intent.breakdown,
                feeLabel: quote.label,
                feeNote: `Estimated network cost, paid by Kumele on your behalf (${quote.estimated_network_fee.sol} SOL)`,
            })
        } catch (e) {
            setState({ kind: 'error', message: describeError(e) })
        }
    }

    // Resolved, not held as a promise. `stripePromise && ...` was the guard, and a Promise is
    // truthy whatever it settles to - so when js.stripe.com is blocked and the promise
    // resolves to null, the "card payments unavailable" branch never ran. <Elements> mounted
    // with a null stripe, its context stayed empty, and checkout hung on a permanently
    // disabled button with no message, after the PaymentIntent already existed.
    const [stripe, setStripe] = useState<Awaited<typeof stripePromise> | undefined>(undefined)
    useEffect(() => {
        let live = true
        stripePromise?.then((s) => live && setStripe(s))
        return () => { live = false }
    }, [])

    const elementsOptions = useMemo(
        () =>
            state.kind === 'checkout'
                ? ({ clientSecret: state.clientSecret, appearance: { theme: 'night' as const } })
                : undefined,
        [state]
    )

    const busy = state.kind === 'busy'
    const inCheckout = state.kind === 'checkout'
    // An error that happened after a payment was created is not a "try again" - the money may
    // already have moved. The mint is guaranteed server-side by the cron sweep either way, so
    // the right thing to offer is the payment reference, not another charge.
    const chargedAlready = state.kind === 'error' && Boolean(state.paymentId)

    return (
        <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
            <h1 className="text-3xl font-bold text-white">Create an NFT</h1>
            <p className="mt-2 text-sm text-white/50">
                {payByCard
                    ? 'Pay by card. Kumele mints on Solana devnet and covers the network cost, which is itemised at checkout.'
                    : solanaUnavailable
                        ? 'Minting on Solana is paused while payments move to card.'
                        : 'You sign and pay your own network fee.'}
            </p>

            <div className="mt-6 space-y-5 rounded-2xl border border-white/[0.07] bg-[#0e1018] p-6">
                <div>
                    {/* A group of buttons, not a form control, so htmlFor has nothing to point
                        at. role=group + aria-labelledby is what actually names it to a screen
                        reader, and aria-pressed is what tells one which is selected. */}
                    <div id="chain-label" className="mb-2 block text-xs uppercase tracking-wider text-white/60">Chain</div>
                    <div className="flex gap-2" role="group" aria-labelledby="chain-label">
                        {(['SOLANA', 'ETHEREUM'] as Chain[]).map((c) => (
                            <button
                                key={c}
                                onClick={() => { setChain(c); setState({ kind: 'idle' }) }}
                                disabled={inCheckout}
                                aria-pressed={chain === c}
                                className={cn(
                                    'inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-40',
                                    chain === c
                                        ? 'bg-indigo-500/20 text-white ring-1 ring-indigo-400/40'
                                        : 'bg-white/[0.03] text-white/55 hover:text-white'
                                )}
                            >
                                <ChainMark chain={c} className={cn('h-4 w-4', CHAIN_UI[c].accent)} />
                                {CHAIN_UI[c].label}
                            </button>
                        ))}
                    </div>
                    {/* Two payment models in one form; saying which is which up front beats
                        letting someone find out at the payment step. */}
                    <p className="mt-2 text-[11px] text-white/55">
                        {payByCard
                            ? 'Solana mints are paid for by card.'
                            : solanaUnavailable
                                ? 'Card payments are not configured for this deployment yet.'
                                : `${CHAIN_UI[chain].label} mints are signed and paid from your own wallet.`}
                    </p>
                </div>

                <div>
                    <label htmlFor="nft-image" className="mb-2 block text-xs uppercase tracking-wider text-white/60">Image</label>
                    <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center hover:border-white/30">
                        {preview ? (
                            <img src={preview} alt="" className="h-40 w-40 rounded-lg object-cover" />
                        ) : (
                            <>
                                <Upload className="h-6 w-6 text-white/35" />
                                <span className="text-sm text-white/50">Choose an image</span>
                            </>
                        )}
                        <input
                            id="nft-image"
                            type="file"
                            accept="image/*"
                            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                            disabled={inCheckout}
                            className="sr-only"
                        />
                    </label>
                </div>

                <div>
                    <label htmlFor="nft-name" className="mb-2 block text-xs uppercase tracking-wider text-white/60">Name</label>
                    <input
                        id="nft-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={inCheckout}
                        placeholder="My NFT"
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-indigo-400/60 focus:outline-none"
                    />
                </div>

                <div>
                    <label htmlFor="nft-description" className="mb-2 block text-xs uppercase tracking-wider text-white/60">Description</label>
                    <textarea
                        id="nft-description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        disabled={inCheckout}
                        rows={3}
                        className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-indigo-400/60 focus:outline-none"
                    />
                </div>

                <div>
                    <label htmlFor="nft-category" className="mb-2 block text-xs uppercase tracking-wider text-white/60">Category</label>
                    <select
                        id="nft-category"
                        value={category}
                        onChange={(e) => setCategory(e.target.value as Category)}
                        disabled={inCheckout}
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white focus:border-indigo-400/60 focus:outline-none"
                    >
                        {CATEGORIES.map((c) => (
                            <option key={c.value} value={c.value} className="bg-[#0e1018]">{c.label}</option>
                        ))}
                    </select>
                </div>

                {state.kind === 'busy' && (
                    <div className="flex items-center gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500/[0.07] p-3.5 text-sm text-white" role="status">
                        <Loader2 className="h-4 w-4 animate-spin text-indigo-300" />
                        {state.step}
                    </div>
                )}
                {state.kind === 'error' && (
                    <div className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.07] p-3.5 text-sm text-white" role="status">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                        <span>
                            {state.message}
                            {state.paymentId && (
                                <span className="mt-1 block text-[11px] text-white/60">
                                    Payment reference{' '}
                                    <code className="font-mono text-white/70">{state.paymentId}</code>. Your
                                    payment is safe and the mint is still being retried — quote this
                                    reference if you need to contact support. Do not pay again.
                                </span>
                            )}
                        </span>
                    </div>
                )}
                {state.kind === 'done' && (
                    <div className="flex items-start gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3.5 text-sm text-white" role="status">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                        <span>
                            Minted.
                            {state.explorerUrl && (
                                <a href={state.explorerUrl} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1 text-indigo-300 underline">
                                    view <ExternalLink className="h-3 w-3" />
                                </a>
                            )}
                        </span>
                    </div>
                )}

                {state.kind === 'checkout' && (
                    <div className="space-y-4 border-t border-white/10 pt-5">
                        <PriceBreakdown
                            breakdown={state.breakdown}
                            feeLabel={state.feeLabel}
                            feeNote={state.feeNote}
                        />
                        <p className="text-[11px] leading-relaxed text-white/55">
                            The NFT is minted to {address?.slice(0, 6)}…{address?.slice(-4)} after your
                            payment clears. You do not need to sign anything.
                        </p>
                        {stripe && elementsOptions ? (
                            <Elements stripe={stripe} options={elementsOptions}>
                                <CheckoutForm
                                    paymentId={state.paymentId}
                                    onMinted={(assetId, signature) =>
                                        setState({
                                            kind: 'done',
                                            assetId,
                                            explorerUrl: signature ? ui.explorerTx(signature) : undefined,
                                        })
                                    }
                                    onFailed={(message) =>
                                        setState({ kind: 'error', message, paymentId: state.paymentId })
                                    }
                                />
                            </Elements>
                        ) : (
                            <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3.5 text-sm text-white" role="status">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                                Card payments are not configured for this deployment
                                (VITE_STRIPE_PUBLISHABLE_KEY is unset).
                            </div>
                        )}
                    </div>
                )}

                {!inCheckout && state.kind !== 'done' && !chargedAlready && !solanaUnavailable && (
                    address ? (
                        <button
                            onClick={start}
                            disabled={busy || !file || !name}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:bg-white/[0.05] disabled:text-white/40"
                        >
                            {payByCard && <CreditCard className="h-4 w-4" />}
                            {busy ? 'Working…' : payByCard ? 'Continue to payment' : `Mint on ${ui.label}`}
                        </button>
                    ) : (
                        // A real connect control rather than a disabled button labelled "connect".
                        // On Solana this is only how we learn where to send the NFT - the wallet
                        // never signs.
                        <ConnectForChain
                            chain={chain}
                            action={payByCard ? 'choose where the NFT is sent' : `mint on ${ui.label}`}
                        />
                    )
                )}
            </div>
        </div>
    )
}
