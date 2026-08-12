import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits } from 'viem'
import {
    ArrowLeft, ExternalLink, BadgeCheck, ImageOff, Loader2, CheckCircle2, AlertCircle, Tag,
    ShoppingCart, Flame,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { CHAIN_UI, formatPrice, shortAddress, relativeTime } from '@/lib/chain-ui'
import { ChainBadge } from '@/components/ChainBadge'
import { MARKET_ABI, NFT_ABI } from '@/lib/evm-abi'
import { signAndSend, describeError } from '@/lib/solana-tx'
import { ConnectForChain } from '@/components/ConnectForChain'
import { LikeButton } from '@/components/LikeButton'

type TxState =
    | { kind: 'idle' }
    | { kind: 'preparing'; message: string }
    | { kind: 'signing'; message: string }
    | { kind: 'confirming'; message: string; hash?: string }
    | { kind: 'success'; message: string; hash?: string; explorerUrl?: string }
    | { kind: 'error'; message: string }

/** One banner for every stage of a transaction, so no flow invents its own status UI. */
const TxBanner = ({ state, onDismiss }: { state: TxState; onDismiss: () => void }) => {
    if (state.kind === 'idle') return null

    const busy = state.kind === 'preparing' || state.kind === 'signing' || state.kind === 'confirming'
    const tone =
        state.kind === 'error'
            ? 'border-red-500/25 bg-red-500/[0.07]'
            : state.kind === 'success'
                ? 'border-emerald-500/25 bg-emerald-500/[0.07]'
                : 'border-indigo-500/25 bg-indigo-500/[0.07]'

    return (
        <div className={cn('flex items-start gap-3 rounded-xl border p-3.5', tone)} role="status" aria-live="polite">
            {busy && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-indigo-300" />}
            {state.kind === 'success' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />}
            {state.kind === 'error' && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />}

            <div className="min-w-0 flex-1">
                <p className="text-sm text-white">{state.message}</p>
                {'explorerUrl' in state && state.explorerUrl && (
                    <a
                        href={state.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200"
                    >
                        View transaction <ExternalLink className="h-3 w-3" />
                    </a>
                )}
            </div>

            {!busy && (
                <button onClick={onDismiss} className="text-xs text-white/40 hover:text-white">
                    Dismiss
                </button>
            )}
        </div>
    )
}

const Detail = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-center justify-between border-b border-white/[0.05] py-2.5 text-sm last:border-0">
        <span className="text-white/45">{label}</span>
        <span className="font-medium text-white">{value}</span>
    </div>
)

export const NftDetailPage = () => {
    const { assetId = '' } = useParams()
    const queryClient = useQueryClient()
    const [tx, setTx] = useState<TxState>({ kind: 'idle' })
    const [listPrice, setListPrice] = useState('')
    // Two-step so an irreversible action needs a second, deliberate click.
    const [confirmBurn, setConfirmBurn] = useState(false)

    const solana = useWallet()
    const evm = useAccount()
    const { writeContractAsync } = useWriteContract()

    const { data: nft, isLoading, isError, error } = useQuery({
        queryKey: ['nft', assetId],
        queryFn: () => api.nft(assetId),
        enabled: Boolean(assetId),
    })

    const { data: contracts } = useQuery({
        queryKey: ['evm-contracts'],
        queryFn: () => api.evmContracts(),
        enabled: nft?.chain === 'ETHEREUM',
    })

    const [pendingHash, setPendingHash] = useState<`0x${string}` | undefined>()
    const receipt = useWaitForTransactionReceipt({ hash: pendingHash })

    if (isLoading) {
        return (
            <div className="mx-auto max-w-6xl px-4 py-10">
                <div className="grid gap-8 lg:grid-cols-2">
                    <div className="aspect-square animate-pulse rounded-2xl bg-white/[0.04]" />
                    <div className="space-y-4">
                        <div className="h-8 w-2/3 animate-pulse rounded bg-white/[0.06]" />
                        <div className="h-4 w-1/3 animate-pulse rounded bg-white/[0.04]" />
                        <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
                    </div>
                </div>
            </div>
        )
    }

    if (isError || !nft) {
        return (
            <div className="mx-auto max-w-2xl px-4 py-20 text-center">
                <AlertCircle className="mx-auto h-8 w-8 text-red-400" />
                <h1 className="mt-4 text-lg font-semibold text-white">NFT not found</h1>
                <p className="mt-1.5 text-sm text-white/50">{(error as Error)?.message ?? assetId}</p>
                <Link to="/" className="mt-5 inline-block rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium">
                    Back to marketplace
                </Link>
            </div>
        )
    }

    const ui = CHAIN_UI[nft.chain]
    const connectedAddress = nft.chain === 'SOLANA' ? solana.publicKey?.toBase58() : evm.address
    // EVM addresses are compared lowercased; Solana base58 is case-sensitive and must not fold.
    const isOwner =
        Boolean(connectedAddress) &&
        (nft.chain === 'ETHEREUM'
            ? connectedAddress!.toLowerCase() === nft.ownerAddress.toLowerCase()
            : connectedAddress === nft.ownerAddress)

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['nft', assetId] })

    // ---------------------------------------------------------------- buy

    const buyEvm = async () => {
        if (!nft.listing || !contracts || !evm.address) return
        try {
            setTx({ kind: 'preparing', message: 'Reading the listing from chain…' })
            const listings = await api.evmListings({ activeOnly: true, limit: 200 })
            const match = listings.data.find((l) => l.assetId === nft.assetId)
            if (!match) throw new Error('This listing is no longer active on chain')

            setTx({ kind: 'signing', message: 'Confirm the purchase in your wallet…' })
            const hash = await writeContractAsync({
                address: contracts.market as `0x${string}`,
                abi: MARKET_ABI,
                functionName: 'buy',
                args: [BigInt(match.listingId)],
                // Exact price in wei from the chain's own value - never re-derived from the
                // display string, and never through a float. The contract requires an exact match.
                value: BigInt(match.priceWei),
            })
            setPendingHash(hash)
            setTx({ kind: 'confirming', message: 'Waiting for confirmation…', hash })
        } catch (e: any) {
            // Surfaced, never swallowed. A wallet rejection is a normal outcome and reads as
            // such; a blocked network call explains itself instead of saying "Failed to fetch".
            setTx({ kind: 'error', message: describeError(e) })
        }
    }

    const buySolana = async () => {
        if (!nft.listing || !solana.publicKey || !solana.signTransaction) return
        try {
            setTx({ kind: 'preparing', message: 'Building the purchase transaction…' })
            const { transaction } = await api.solanaBuy({
                assetId: nft.assetId,
                buyer: solana.publicKey.toBase58(),
                seller: nft.listing.sellerAddress,
            })

            setTx({ kind: 'signing', message: 'Approve the purchase in your wallet…' })
            // signAndSend decodes the versioned format umi emits and throws if the transaction
            // lands but errors on chain, rather than reporting a success that did not happen.
            const { signature } = await signAndSend(solana, transaction)

            setTx({ kind: 'confirming', message: 'Verifying against the chain…' })
            // Re-checked server-side: a resolved send only means the node accepted it.
            const verified = await api.solanaVerify(signature).catch(() => ({ verified: false }))
            if (!verified.verified) throw new Error('Transaction did not confirm successfully')

            setTx({
                kind: 'success',
                message: 'Purchased. The NFT is now in your wallet.',
                explorerUrl: ui.explorerTx(signature),
            })
            refresh()
        } catch (e: any) {
            setTx({ kind: 'error', message: describeError(e) })
        }
    }

    // ---------------------------------------------------------------- list

    const listEvm = async () => {
        if (!contracts || !evm.address) return
        try {
            const priceWei = parseUnits(listPrice, 18)
            if (priceWei <= 0n) throw new Error('Enter a price above zero')

            setTx({ kind: 'signing', message: 'Approve the marketplace to move this NFT…' })
            const approveHash = await writeContractAsync({
                address: contracts.nft as `0x${string}`,
                abi: NFT_ABI,
                functionName: 'setApprovalForAll',
                args: [contracts.market as `0x${string}`, true],
            })
            setTx({ kind: 'confirming', message: 'Waiting for the approval…', hash: approveHash })

            setTx({ kind: 'signing', message: 'Now confirm the listing…' })
            const hash = await writeContractAsync({
                address: contracts.market as `0x${string}`,
                abi: MARKET_ABI,
                functionName: 'list',
                args: [contracts.nft as `0x${string}`, BigInt(nft.tokenId!), priceWei],
            })
            setPendingHash(hash)
            setTx({ kind: 'confirming', message: 'Waiting for confirmation…', hash })
        } catch (e: any) {
            setTx({ kind: 'error', message: describeError(e) })
        }
    }

    const listSolana = async () => {
        if (!solana.publicKey || !solana.signTransaction) return
        try {
            setTx({ kind: 'preparing', message: 'Building the listing transaction…' })
            // Price stays a string to the API, which parses it to lamports exactly.
            const { transaction } = await api.solanaList({
                assetId: nft.assetId,
                seller: solana.publicKey.toBase58(),
                price: listPrice,
            })

            setTx({ kind: 'signing', message: 'Approve the listing in your wallet…' })
            const { signature } = await signAndSend(solana, transaction)

            setTx({ kind: 'success', message: 'Listed for sale.', explorerUrl: ui.explorerTx(signature) })
            refresh()
        } catch (e: any) {
            setTx({ kind: 'error', message: describeError(e) })
        }
    }

    // ---------------------------------------------------------------- burn

    const burn = async () => {
        if (!solana.publicKey || nft.chain !== 'SOLANA') return
        try {
            setTx({ kind: 'preparing', message: 'Building the burn transaction…' })
            const { transaction } = await api.solanaBurn({
                assetId: nft.assetId,
                owner: solana.publicKey.toBase58(),
            })

            setTx({ kind: 'signing', message: 'Confirm the burn in your wallet. This cannot be undone.' })
            const { signature } = await signAndSend(solana, transaction)

            setTx({ kind: 'confirming', message: 'Verifying the burn on chain…' })
            // The row is only removed after the backend re-checks the chain itself.
            const result = await api.solanaBurnConfirm({ assetId: nft.assetId, signature })

            setTx({
                kind: 'success',
                message: `${result.name} was burned. It no longer exists on chain.`,
                explorerUrl: result.explorerUrl,
            })
            setConfirmBurn(false)
        } catch (e: any) {
            setTx({ kind: 'error', message: describeError(e) })
            setConfirmBurn(false)
        }
    }

    // Once an EVM receipt lands, report from its actual status rather than assuming success.
    if (pendingHash && receipt.isSuccess && tx.kind === 'confirming') {
        setPendingHash(undefined)
        setTx({
            kind: 'success',
            message: 'Confirmed on Base Sepolia.',
            explorerUrl: ui.explorerTx(pendingHash),
        })
        refresh()
    }
    if (pendingHash && receipt.isError && tx.kind === 'confirming') {
        setPendingHash(undefined)
        setTx({ kind: 'error', message: 'The transaction reverted on chain' })
    }

    const walletConnected = Boolean(connectedAddress)
    const busy = tx.kind === 'preparing' || tx.kind === 'signing' || tx.kind === 'confirming'

    return (
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
            <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-white/50 hover:text-white">
                <ArrowLeft className="h-4 w-4" /> Marketplace
            </Link>

            <div className="grid gap-8 lg:grid-cols-2">
                <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0e1018]">
                    <div className="aspect-square">
                        {nft.imageUrl ? (
                            <img src={nft.imageUrl} alt={nft.name} className="h-full w-full object-cover" />
                        ) : (
                            <div className="flex h-full flex-col items-center justify-center gap-2 text-white/25">
                                <ImageOff className="h-10 w-10" />
                                <span className="text-xs uppercase tracking-wider">No image available</span>
                            </div>
                        )}
                    </div>
                    <div className="absolute left-4 top-4">
                        <ChainBadge chain={nft.chain} variant="pill" />
                    </div>
                </div>

                <div className="space-y-5">
                    <div>
                        {nft.collection && (
                            <Link
                                to={`/?collection=${nft.collection.slug}`}
                                className="inline-flex items-center gap-1.5 text-sm text-indigo-300 hover:text-indigo-200"
                            >
                                {nft.collection.name}
                                {nft.collection.verified && <BadgeCheck className="h-4 w-4 text-sky-400" />}
                            </Link>
                        )}
                        <h1 className="mt-1 text-3xl font-bold text-white">{nft.name}</h1>
                        <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-white/45">
                            <LikeButton assetId={nft.assetId} likeCount={nft.likeCount} size="lg" className="-ml-1" />
                            <span>Owned by {isOwner ? 'you' : shortAddress(nft.ownerAddress, 6, 6)}</span>
                            <span>Minted {relativeTime(nft.mintedAt)}</span>
                        </div>
                    </div>

                    {nft.description && <p className="text-sm leading-relaxed text-white/60">{nft.description}</p>}

                    <TxBanner state={tx} onDismiss={() => setTx({ kind: 'idle' })} />

                    <div className="rounded-2xl border border-white/[0.07] bg-[#0e1018] p-5">
                        {nft.listing ? (
                            <>
                                <div className="text-xs uppercase tracking-wider text-white/40">Current price</div>
                                <div className="mt-1 text-3xl font-bold text-white">
                                    {formatPrice(nft.listing.price)}{' '}
                                    <span className={ui.accent}>{nft.listing.currency}</span>
                                </div>

                                {!walletConnected ? (
                                    <div className="mt-4">
                                        <ConnectForChain chain={nft.chain} action="buy this NFT" />
                                    </div>
                                ) : isOwner ? (
                                    <p className="mt-4 rounded-xl bg-white/[0.03] p-3 text-sm text-white/50">
                                        This is your listing.
                                    </p>
                                ) : (
                                    <button
                                        onClick={nft.chain === 'ETHEREUM' ? buyEvm : buySolana}
                                        disabled={busy}
                                        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:opacity-60"
                                    >
                                        <ShoppingCart className="h-4 w-4" />
                                        {busy ? 'Working…' : `Buy for ${formatPrice(nft.listing.price)} ${nft.listing.currency}`}
                                    </button>
                                )}
                            </>
                        ) : isOwner ? (
                            <>
                                <div className="text-xs uppercase tracking-wider text-white/40">List for sale</div>
                                <div className="mt-3 flex gap-2">
                                    <input
                                        value={listPrice}
                                        onChange={(e) =>
                                            setListPrice(e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))
                                        }
                                        placeholder={`Price in ${ui.currency}`}
                                        inputMode="decimal"
                                        aria-label={`Price in ${ui.currency}`}
                                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-indigo-400/60 focus:outline-none"
                                    />
                                    <button
                                        onClick={nft.chain === 'ETHEREUM' ? listEvm : listSolana}
                                        disabled={busy || !listPrice}
                                        className="flex shrink-0 items-center gap-2 rounded-xl bg-indigo-500 px-5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:opacity-60"
                                    >
                                        <Tag className="h-4 w-4" />
                                        List
                                    </button>
                                </div>
                                {nft.chain === 'ETHEREUM' && (
                                    <p className="mt-2 text-[11px] text-white/35">
                                        Two signatures: one approving the marketplace, one creating the listing. The
                                        NFT stays in your wallet until it sells.
                                    </p>
                                )}
                            </>
                        ) : (
                            <p className="text-sm text-white/50">Not currently listed for sale.</p>
                        )}
                    </div>

                    <div className="rounded-2xl border border-white/[0.07] bg-[#0e1018] p-5">
                        <h2 className="mb-2 text-sm font-semibold text-white">Details</h2>
                        <Detail label="Chain" value={ui.label} />
                        <Detail label="Network" value={ui.network} />
                        <Detail label="Category" value={nft.category.replace(/_/g, ' ')} />
                        {nft.tokenId && <Detail label="Token ID" value={`#${nft.tokenId}`} />}
                        <Detail
                            label={nft.chain === 'SOLANA' ? 'Mint' : 'Contract'}
                            value={
                                <a
                                    href={ui.explorerAddress(nft.mintAddress ?? nft.contractAddress ?? '')}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200"
                                >
                                    {shortAddress(nft.mintAddress ?? nft.contractAddress, 6, 6)}
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            }
                        />
                    </div>

                    {isOwner && nft.chain === 'SOLANA' && !nft.listing && (
                        <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.04] p-5">
                            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                                <Flame className="h-4 w-4 text-red-400" />
                                Burn this NFT
                            </h2>
                            <p className="mt-1.5 text-xs leading-relaxed text-white/50">
                                Destroys the asset on chain permanently. The rent is returned to you. There
                                is no undo, and no way to recover it afterwards.
                            </p>

                            {confirmBurn ? (
                                <div className="mt-3 flex gap-2">
                                    <button
                                        onClick={burn}
                                        disabled={busy}
                                        className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-400 disabled:opacity-60"
                                    >
                                        {busy ? 'Burning…' : `Yes, permanently burn ${nft.name}`}
                                    </button>
                                    <button
                                        onClick={() => setConfirmBurn(false)}
                                        className="rounded-xl border border-white/10 px-4 text-sm text-white/70 hover:bg-white/5"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setConfirmBurn(true)}
                                    className="mt-3 inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10"
                                >
                                    <Flame className="h-4 w-4" />
                                    Burn
                                </button>
                            )}
                        </div>
                    )}

                    {nft.music && (
                        <div className="rounded-2xl border border-white/[0.07] bg-[#0e1018] p-5">
                            <h2 className="mb-1 text-sm font-semibold text-white">{nft.music.title}</h2>
                            <p className="mb-3 text-xs text-white/45">
                                {nft.music.album.artist} · {nft.music.album.name}
                            </p>
                            {/* Streams from the worker's /cdn/audio route, which honours range requests. */}
                            <audio controls preload="none" src={nft.music.audioUrl} className="w-full" />
                        </div>
                    )}

                    {nft.sales.length > 0 && (
                        <div className="rounded-2xl border border-white/[0.07] bg-[#0e1018] p-5">
                            <h2 className="mb-2 text-sm font-semibold text-white">Sale history</h2>
                            {nft.sales.map((s) => (
                                <div
                                    key={s.txHash}
                                    className="flex items-center justify-between border-b border-white/[0.05] py-2.5 text-sm last:border-0"
                                >
                                    <span className="text-white/45">
                                        {shortAddress(s.sellerAddress)} → {shortAddress(s.buyerAddress)}
                                    </span>
                                    <span className="flex items-center gap-2 font-medium text-white">
                                        {formatPrice(s.price)} {s.currency}
                                        <a href={s.explorerUrl} target="_blank" rel="noreferrer" className="text-indigo-300">
                                            <ExternalLink className="h-3 w-3" />
                                        </a>
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
