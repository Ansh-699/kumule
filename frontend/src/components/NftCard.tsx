import { Link } from 'react-router-dom'
import { BadgeCheck, ImageOff } from 'lucide-react'
import { LikeButton } from './LikeButton'
import { cn } from '@/lib/utils'
import { ChainBadge } from './ChainBadge'
import { CHAIN_UI, formatPrice, shortAddress } from '@/lib/chain-ui'
import type { Nft } from '@/lib/api'

/**
 * A marketplace card.
 *
 * Two things are always true regardless of variant: the chain is visible, and the price shows
 * its own currency. A grid mixing 12.5 SOL and 1.25 ETH is unreadable if either is implied.
 */

const ImageArea = ({ nft, className }: { nft: Nft; className?: string }) => (
    <div className={cn('relative overflow-hidden bg-white/[0.03]', className)}>
        {nft.imageUrl ? (
            <img
                src={nft.imageUrl}
                alt={nft.name}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                onError={(e) => {
                    // The backend flags unresolvable images, but a host can fail after indexing.
                    // Swapping in the placeholder beats a browser's broken-image glyph.
                    e.currentTarget.style.display = 'none'
                    e.currentTarget.nextElementSibling?.classList.remove('hidden')
                }}
            />
        ) : null}
        <div
            className={cn(
                'absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/25',
                nft.imageUrl && 'hidden'
            )}
        >
            <ImageOff className="h-8 w-8" />
            <span className="text-[11px] uppercase tracking-wider">No image</span>
        </div>
    </div>
)

export const NftCard = ({ nft }: { nft: Nft }) => {
    const ui = CHAIN_UI[nft.chain]
    const price = nft.listing?.price

    return (
        <Link
            to={`/nft/${encodeURIComponent(nft.assetId)}`}
            className={cn(
                'group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.07]',
                'bg-[#0e1018] transition-all duration-300',
                'hover:-translate-y-1 hover:border-white/[0.14]',
                ui.hoverGlow
            )}
        >
            <div className="relative aspect-square">
                <ImageArea nft={nft} className="h-full w-full" />
                <div className="absolute inset-x-3 top-3 flex items-start justify-between">
                    <ChainBadge chain={nft.chain} />
                    <LikeButton assetId={nft.assetId} likeCount={nft.likeCount} />
                </div>
            </div>

            <div className="flex flex-1 flex-col gap-2.5 p-3.5">
                <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-white">{nft.name}</h3>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-white/45">
                        <span className="truncate">
                            {nft.collection?.name ?? shortAddress(nft.creatorAddress ?? nft.ownerAddress)}
                        </span>
                        {nft.collection?.verified && (
                            <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-sky-400" aria-label="Verified" />
                        )}
                    </div>
                </div>

                <div className="mt-auto border-t border-white/[0.06] pt-2.5">
                    {price ? (
                        <>
                            <div className="text-[10px] uppercase tracking-wider text-white/35">Price</div>
                            <div className="text-sm font-semibold text-white">
                                {formatPrice(price)}{' '}
                                <span className={ui.accent}>{nft.listing!.currency}</span>
                            </div>
                        </>
                    ) : (
                        <div className="text-xs text-white/35">Not listed</div>
                    )}
                </div>
            </div>
        </Link>
    )
}

/** Row form for the list toggle. Same data, denser, with the owner exposed. */
export const NftRow = ({ nft }: { nft: Nft }) => {
    const ui = CHAIN_UI[nft.chain]
    const price = nft.listing?.price

    return (
        <Link
            to={`/nft/${encodeURIComponent(nft.assetId)}`}
            className="group flex items-center gap-4 rounded-xl border border-white/[0.07] bg-[#0e1018] p-3 transition-colors hover:border-white/[0.14]"
        >
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg">
                <ImageArea nft={nft} className="h-full w-full" />
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-white">{nft.name}</h3>
                    {nft.collection?.verified && (
                        <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-sky-400" aria-label="Verified" />
                    )}
                </div>
                <div className="truncate text-xs text-white/45">
                    {nft.collection?.name ?? shortAddress(nft.ownerAddress)}
                </div>
            </div>

            <div className="hidden shrink-0 sm:block">
                <ChainBadge chain={nft.chain} variant="pill" />
            </div>

            <div className="hidden shrink-0 md:flex">
                <LikeButton assetId={nft.assetId} likeCount={nft.likeCount} />
            </div>

            <div className="w-28 shrink-0 text-right">
                {price ? (
                    <div className="text-sm font-semibold text-white">
                        {formatPrice(price)} <span className={ui.accent}>{nft.listing!.currency}</span>
                    </div>
                ) : (
                    <span className="text-xs text-white/35">Not listed</span>
                )}
            </div>
        </Link>
    )
}

/** Matches the card's footprint so the grid does not reflow when results land. */
export const NftCardSkeleton = () => (
    <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0e1018]">
        <div className="aspect-square animate-pulse bg-white/[0.04]" />
        <div className="space-y-2 p-3.5">
            <div className="h-4 w-2/3 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-white/[0.06]" />
        </div>
    </div>
)
