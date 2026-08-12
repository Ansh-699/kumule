import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, AlertCircle, Boxes } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api, type Chain } from '@/lib/api'
import { CHAIN_UI, formatPrice, formatCount } from '@/lib/chain-ui'
import { ChainBadge, ChainMark } from '@/components/ChainBadge'

export const CollectionsPage = () => {
    const [chain, setChain] = useState<Chain | undefined>()
    const { data, isLoading, isError, error } = useQuery({
        queryKey: ['collections', chain],
        queryFn: () => api.collections({ chain, limit: 60 }),
    })

    const collections = data?.data ?? []

    return (
        <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
            <h1 className="text-3xl font-bold text-white sm:text-4xl">Collections</h1>
            <p className="mt-2 text-sm text-white/50">
                Curated collections across Solana and Ethereum, with live floor prices and volume.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
                {([undefined, 'SOLANA', 'ETHEREUM'] as const).map((c) => (
                    <button
                        key={c ?? 'all'}
                        onClick={() => setChain(c)}
                        className={cn(
                            'inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors',
                            chain === c
                                ? 'bg-indigo-500/20 text-white ring-1 ring-indigo-400/40'
                                : 'bg-white/[0.03] text-white/60 hover:bg-white/[0.06] hover:text-white'
                        )}
                    >
                        {c && <ChainMark chain={c} className={cn('h-4 w-4', CHAIN_UI[c].accent)} />}
                        {c ? CHAIN_UI[c].label : 'All chains'}
                    </button>
                ))}
            </div>

            {isError && (
                <div className="mt-6 flex items-start gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] p-5">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                    <div>
                        <h3 className="text-sm font-semibold text-white">Could not load collections</h3>
                        <p className="mt-1 text-sm text-white/55">{(error as Error)?.message}</p>
                    </div>
                </div>
            )}

            {isLoading && (
                <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0e1018]">
                            <div className="h-32 animate-pulse bg-white/[0.04]" />
                            <div className="space-y-2 p-4">
                                <div className="h-4 w-2/3 animate-pulse rounded bg-white/[0.06]" />
                                <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {!isLoading && !isError && collections.length === 0 && (
                <div className="mt-6 rounded-2xl border border-white/[0.07] bg-[#0e1018] p-12 text-center">
                    <Boxes className="mx-auto h-8 w-8 text-white/25" />
                    <h3 className="mt-3 text-sm font-semibold text-white">No collections yet</h3>
                    <p className="mx-auto mt-1.5 max-w-sm text-sm text-white/45">
                        Collections appear here once NFTs are grouped into one. Individual NFTs are still
                        browsable on the marketplace.
                    </p>
                    <Link to="/" className="mt-4 inline-block rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium">
                        Browse NFTs
                    </Link>
                </div>
            )}

            {collections.length > 0 && (
                <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {collections.map((col) => (
                        <Link
                            key={col.id}
                            to={`/?collection=${encodeURIComponent(col.slug)}`}
                            className="group overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0e1018] transition-all hover:-translate-y-1 hover:border-white/[0.14]"
                        >
                            <div className="relative h-32 overflow-hidden bg-white/[0.03]">
                                {col.bannerUrl || col.imageUrl ? (
                                    <img
                                        src={col.bannerUrl ?? col.imageUrl!}
                                        alt={col.name}
                                        loading="lazy"
                                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                    />
                                ) : null}
                                <div className="absolute right-3 top-3">
                                    <ChainBadge chain={col.chain} />
                                </div>
                            </div>

                            <div className="p-4">
                                <div className="flex items-center gap-1.5">
                                    <h3 className="truncate text-sm font-semibold text-white">{col.name}</h3>
                                    {col.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-sky-400" />}
                                </div>

                                <div className="mt-3 flex items-center justify-between text-xs">
                                    <div>
                                        <div className="text-white/35">Floor</div>
                                        <div className="mt-0.5 font-medium text-white">
                                            {col.floorPrice
                                                ? `${formatPrice(col.floorPrice)} ${col.currency}`
                                                : '—'}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-white/35">Items</div>
                                        <div className="mt-0.5 font-medium text-white">{formatCount(col.itemCount)}</div>
                                    </div>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    )
}
