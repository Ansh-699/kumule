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
import { describeError } from '@/lib/solana-tx'
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
const stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null

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
    | { kind: 'error'; message: string }

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

    const address = chain === 'SOLANA' ? solana.publicKey?.toBase58() : evm.address
    const ui = CHAIN_UI[chain]
    const payByCard = chain === 'SOLANA'

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

            // Solana: priced, then paid for by card. Nothing is minted until Stripe confirms.
            setState({ kind: 'busy', step: 'Pricing the mint…' })
            const quote = await api.feeQuote({ operation: 'nft_mint', chain: 'solana', quantity: 1 })

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

    const elementsOptions = useMemo(
        () =>
            state.kind === 'checkout'
                ? ({ clientSecret: state.clientSecret, appearance: { theme: 'night' as const } })
                : undefined,
        [state]
    )

    const busy = state.kind === 'busy'
    const inCheckout = state.kind === 'checkout'

    return (
        <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
            <h1 className="text-3xl font-bold text-white">Create an NFT</h1>
            <p className="mt-2 text-sm text-white/50">
                {payByCard
                    ? 'Pay by card. Kumele mints on Solana devnet and covers the network cost, which is itemised at checkout.'
                    : 'Mint on Base Sepolia. You sign and pay your own network fee.'}
            </p>

            <div className="mt-6 space-y-5 rounded-2xl border border-white/[0.07] bg-[#0e1018] p-6">
                <div>
                    <label className="mb-2 block text-xs uppercase tracking-wider text-white/40">Chain</label>
                    <div className="flex gap-2">
                        {(['SOLANA', 'ETHEREUM'] as Chain[]).map((c) => (
                            <button
                                key={c}
                                onClick={() => { setChain(c); setState({ kind: 'idle' }) }}
                                disabled={inCheckout}
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
                    <p className="mt-2 text-[11px] text-white/35">
                        {payByCard
                            ? 'Solana mints are paid for by card.'
                            : 'Base mints are signed and paid from your own wallet.'}
                    </p>
                </div>

                <div>
                    <label className="mb-2 block text-xs uppercase tracking-wider text-white/40">Image</label>
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
                            type="file"
                            accept="image/*"
                            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                            disabled={inCheckout}
                            className="sr-only"
                        />
                    </label>
                </div>

                <div>
                    <label className="mb-2 block text-xs uppercase tracking-wider text-white/40">Name</label>
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={inCheckout}
                        placeholder="My NFT"
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-indigo-400/60 focus:outline-none"
                    />
                </div>

                <div>
                    <label className="mb-2 block text-xs uppercase tracking-wider text-white/40">Description</label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        disabled={inCheckout}
                        rows={3}
                        className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-indigo-400/60 focus:outline-none"
                    />
                </div>

                <div>
                    <label className="mb-2 block text-xs uppercase tracking-wider text-white/40">Category</label>
                    <select
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
                        {state.message}
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
                        <p className="text-[11px] leading-relaxed text-white/35">
                            The NFT is minted to {address?.slice(0, 6)}…{address?.slice(-4)} after your
                            payment clears. You do not need to sign anything.
                        </p>
                        {stripePromise && elementsOptions ? (
                            <Elements stripe={stripePromise} options={elementsOptions}>
                                <CheckoutForm
                                    paymentId={state.paymentId}
                                    onMinted={(assetId, signature) =>
                                        setState({
                                            kind: 'done',
                                            assetId,
                                            explorerUrl: signature ? ui.explorerTx(signature) : undefined,
                                        })
                                    }
                                    onFailed={(message) => setState({ kind: 'error', message })}
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

                {!inCheckout && state.kind !== 'done' && (
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
