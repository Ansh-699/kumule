import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
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
    const publicClient = usePublicClient()

    const { data: nft, isLoading, isError, error } = useQuery({
        queryKey: ['nft', assetId],
        queryFn: () => api.nft(assetId),
        enabled: Boolean(assetId),
    })

    // Which rails are live. With direct crypto switched off the Solana escrow routes 404, so
    // the controls that call them must not be drawn at all - a Buy button that fails on click
    // is worse than one that was never there.
    const { data: chainInfo } = useQuery({
        queryKey: ['chains'],
        queryFn: () => api.chains(),
        staleTime: 5 * 60_000,
    })
    const directCrypto = chainInfo?.features?.directCrypto ?? false

    const { data: contracts } = useQuery({
        queryKey: ['evm-contracts'],
        queryFn: () => api.evmContracts(),
        enabled: nft?.chain === 'ETHEREUM',
    })

    // What still has to happen once an EVM transaction is mined. The kind travels with the hash
    // because a buy has to settle the sale afterwards and a listing has to be indexed, and the
    // receipt hook on its own cannot tell the two apart.
    const [pending, setPending] = useState<{ hash: `0x${string}`; kind: 'buy' | 'list' } | null>(null)
    const receipt = useWaitForTransactionReceipt({ hash: pending?.hash })

    // An effect, not a branch in the render body. This used to call setState and invalidate
    // queries while rendering, which is a side effect in the middle of a render pass.
    useEffect(() => {
        if (!pending || !nft) return

        if (receipt.isError) {
            setPending(null)
            setTx({ kind: 'error', message: 'The transaction reverted on chain' })
            return
        }
        if (!receipt.isSuccess) return

        const { hash, kind } = pending
        setPending(null)
        const explorerUrl = CHAIN_UI[nft.chain].explorerTx(hash)

        void (async () => {
            try {
                if (kind === 'buy') {
                    if (!evm.address) throw new Error('Wallet disconnected')
                    setTx({ kind: 'confirming', message: 'Recording the sale…', hash })
                    await api.settle({ assetId: nft.assetId, txHash: hash, buyer: evm.address })
                    setTx({ kind: 'success', message: 'Purchased. The NFT is now in your wallet.', explorerUrl })
                } else {
                    setTx({ kind: 'confirming', message: 'Publishing the listing…', hash })
                    await api.evmIndexListing(hash)
                    setTx({ kind: 'success', message: 'Listed for sale.', explorerUrl })
                }
            } catch {
                // The chain transaction succeeded regardless; only our copy of it is behind.
                // Reporting a failure here would tell someone their purchase did not go through
                // when it did.
                setTx({
                    kind: 'success',
                    message:
                        kind === 'buy'
                            ? 'Purchased on chain. The marketplace may take a moment to catch up.'
                            : 'Listed on chain. The marketplace may take a moment to catch up.',
                    explorerUrl,
                })
            }
            queryClient.invalidateQueries({ queryKey: ['nft', nft.assetId] })
            queryClient.invalidateQueries({ queryKey: ['nfts'] })
        })()
    }, [pending, receipt.isSuccess, receipt.isError, nft, evm.address, queryClient])

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
            setPending({ hash, kind: 'buy' })
            setTx({ kind: 'confirming', message: 'Waiting for confirmation…', hash })
        } catch (e) {
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

            // Closes the listing, moves the owner and writes the sale. Without this step the
            // purchase succeeded on chain while the marketplace went on showing the NFT for
            // sale under the seller's name, with volume stuck at zero.
            const synced = await api
                .settle({ assetId: nft.assetId, txHash: signature, buyer: solana.publicKey.toBase58() })
                .then(() => true)
                .catch(() => false)

            setTx({
                kind: 'success',
                message: synced
                    ? 'Purchased. The NFT is now in your wallet.'
                    : 'Purchased on chain. The marketplace may take a moment to catch up.',
                explorerUrl: ui.explorerTx(signature),
            })
            refresh()
        } catch (e) {
            setTx({ kind: 'error', message: describeError(e) })
        }
    }

    // ---------------------------------------------------------------- list

    const listEvm = async () => {
        if (!contracts || !evm.address || !publicClient) return
        try {
            const priceWei = parseUnits(listPrice, 18)
            if (priceWei <= 0n) throw new Error('Enter a price above zero')

            setTx({ kind: 'preparing', message: 'Checking the marketplace approval…' })
            // list() reverts with MarketNotApproved unless this already reads true, and
            // writeContractAsync resolves when a transaction is *submitted*, not when it is
            // mined. Firing both signatures back to back therefore listed against an approval
            // that had not landed yet, so the listing reverted essentially every time.
            const approved = await publicClient.readContract({
                address: contracts.nft as `0x${string}`,
                abi: NFT_ABI,
                functionName: 'isApprovedForAll',
                args: [evm.address, contracts.market as `0x${string}`],
            })

            if (!approved) {
                setTx({ kind: 'signing', message: 'Approve the marketplace to move this NFT…' })
                const approveHash = await writeContractAsync({
                    address: contracts.nft as `0x${string}`,
                    abi: NFT_ABI,
                    functionName: 'setApprovalForAll',
                    args: [contracts.market as `0x${string}`, true],
                })
                setTx({ kind: 'confirming', message: 'Waiting for the approval to be mined…', hash: approveHash })
                await publicClient.waitForTransactionReceipt({ hash: approveHash })
            }

            setTx({ kind: 'signing', message: 'Now confirm the listing…' })
            const hash = await writeContractAsync({
                address: contracts.market as `0x${string}`,
                abi: MARKET_ABI,
                functionName: 'list',
                args: [contracts.nft as `0x${string}`, BigInt(nft.tokenId!), priceWei],
            })
            setPending({ hash, kind: 'list' })
            setTx({ kind: 'confirming', message: 'Waiting for confirmation…', hash })
        } catch (e) {
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

            // The listing row is written here rather than when the transaction was built, so
            // rejecting the signature no longer leaves the marketplace advertising an NFT that
            // was never escrowed. The backend reads the price back out of the escrow account.
            setTx({ kind: 'confirming', message: 'Publishing the listing…' })
            const synced = await api
                .solanaListingSync({ assetId: nft.assetId, seller: solana.publicKey.toBase58(), signature })
                .then(() => true)
                .catch(() => false)

            setTx({
                kind: 'success',
                message: synced
                    ? 'Listed for sale.'
                    : 'Escrowed on chain. The listing will appear once the marketplace catches up.',
                explorerUrl: ui.explorerTx(signature),
            })
            refresh()
        } catch (e) {
            setTx({ kind: 'error', message: describeError(e) })
        }
    }

    // ---------------------------------------------------------------- cancel

    /**
     * Take a listing down. There was no way to do this from the UI at all: an owner looking at
     * their own listing saw "This is your listing." and nothing else, so anything listed stayed
     * listed forever.
     */
    const cancelSolana = async () => {
        if (!solana.publicKey || !solana.signTransaction) return
        try {
            setTx({ kind: 'preparing', message: 'Building the cancel transaction…' })
            const { transaction } = await api.solanaCancel({
                assetId: nft.assetId,
                seller: solana.publicKey.toBase58(),
            })

            setTx({ kind: 'signing', message: 'Confirm in your wallet to take this off sale…' })
            const { signature } = await signAndSend(solana, transaction)

            setTx({ kind: 'confirming', message: 'Updating the marketplace…' })
            await api
                .solanaListingSync({ assetId: nft.assetId, seller: solana.publicKey.toBase58(), signature })
                .catch(() => null)

            setTx({
                kind: 'success',
                message: 'Listing cancelled. The NFT is back in your wallet.',
                explorerUrl: ui.explorerTx(signature),
            })
            refresh()
        } catch (e) {
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
        } catch (e) {
            setTx({ kind: 'error', message: describeError(e) })
            setConfirmBurn(false)
        }
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

                                {/* The flag is checked before the wallet, deliberately. The other
                                    order asks someone to connect a wallet for an action that is
                                    switched off, and only tells them once they have. */}
                                {nft.chain === 'SOLANA' && !directCrypto ? (
                                    <p className="mt-4 rounded-xl bg-white/[0.03] p-3 text-sm text-white/50">
                                        Buying on Solana is paused while payments move to card.
                                        This listing is still live on chain.
                                    </p>
                                ) : !walletConnected ? (
                                    <div className="mt-4">
                                        <ConnectForChain chain={nft.chain} action="buy this NFT" />
                                    </div>
                                ) : isOwner ? (
                                    <div className="mt-4">
                                        <p className="rounded-xl bg-white/[0.03] p-3 text-sm text-white/50">
                                            This is your listing.
                                        </p>
                                        {nft.chain === 'SOLANA' && directCrypto && (
                                            <button
                                                onClick={cancelSolana}
                                                disabled={busy}
                                                className="mt-2 w-full rounded-xl border border-white/10 py-2.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/5 disabled:opacity-60"
                                            >
                                                {busy ? 'Working…' : 'Cancel listing'}
                                            </button>
                                        )}
                                    </div>
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
                        ) : isOwner && nft.chain === 'SOLANA' && !directCrypto ? (
                            <p className="text-sm text-white/50">
                                Listing on Solana is paused while payments move to card.
                            </p>
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
