import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query'
import { LayoutGrid, List, Search, AlertCircle, Wallet, Users, TrendingUp, Tag, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api, type Chain, type SortKey } from '@/lib/api'
import { CHAIN_UI, SORT_OPTIONS, formatCount, formatPrice } from '@/lib/chain-ui'
import { NftCard, NftRow, NftCardSkeleton } from '@/components/NftCard'
import { ChainMark } from '@/components/ChainBadge'
import { FilterSidebar, EMPTY_FILTERS, filtersToQuery, type Filters } from '@/components/FilterSidebar'

const PAGE_SIZE = 24

const StatTile = ({
    icon: Icon, value, label,
}: { icon: typeof Wallet; value: string; label: string }) => (
    <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-300">
            <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
            <div className="truncate text-lg font-semibold text-white">{value}</div>
            <div className="truncate text-xs text-white/40">{label}</div>
        </div>
    </div>
)

/** Live totals from /api/stats. Renders nothing rather than zeros if the call fails. */
const StatsBar = () => {
    const { data, isError } = useQuery({ queryKey: ['stats', 30], queryFn: () => api.stats(30) })
    if (isError || !data) return null

    return (
        <div className="grid grid-cols-2 gap-5 rounded-2xl border border-white/[0.07] bg-[#0e1018] p-5 sm:grid-cols-4">
            <StatTile icon={Wallet} value={formatCount(data.totals.nfts)} label="NFTs" />
            <StatTile icon={Users} value={formatCount(data.totals.collectors)} label="Collectors" />
            <StatTile
                icon={TrendingUp}
                value={`${formatPrice(data.chains.SOLANA.volume, 2)} SOL`}
                label={`Volume (${data.windowDays}D)`}
            />
            <StatTile
                icon={Tag}
                value={`${formatPrice(data.chains.ETHEREUM.volume, 3)} ETH`}
                label={`Volume (${data.windowDays}D)`}
            />
        </div>
    )
}

const ChainTabs = ({
    value, onChange,
}: { value: Chain | undefined; onChange: (c: Chain | undefined) => void }) => {
    const tabs: Array<{ label: string; chain: Chain | undefined }> = [
        { label: 'All NFTs', chain: undefined },
        { label: 'Solana', chain: 'SOLANA' },
        { label: 'Ethereum', chain: 'ETHEREUM' },
    ]
    return (
        <div className="flex flex-wrap gap-2">
            {tabs.map((t) => (
                <button
                    key={t.label}
                    onClick={() => onChange(t.chain)}
                    className={cn(
                        'inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors',
                        value === t.chain
                            ? 'bg-indigo-500/20 text-white ring-1 ring-indigo-400/40'
                            : 'bg-white/[0.03] text-white/60 hover:bg-white/[0.06] hover:text-white'
                    )}
                >
                    {t.chain && <ChainMark chain={t.chain} className={cn('h-4 w-4', CHAIN_UI[t.chain].accent)} />}
                    {t.label}
                </button>
            ))}
        </div>
    )
}

const ChainHeroCard = ({ chain }: { chain: Chain }) => {
    const ui = CHAIN_UI[chain]
    const { data } = useQuery({ queryKey: ['stats', 30], queryFn: () => api.stats(30) })
    const stats = data?.chains[chain]

    return (
        <div className="flex items-start gap-3 rounded-2xl border border-white/[0.07] bg-[#0e1018] p-4">
            <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', ui.badge)}>
                <ChainMark chain={chain} className="h-5 w-5" />
            </span>
            <div className="min-w-0">
                <h3 className="text-sm font-semibold text-white">{ui.label}</h3>
                <p className="text-xs text-white/45">{ui.network}</p>
                <p className="mt-1.5 text-xs text-white/60">
                    {stats ? `${formatCount(stats.nfts)} NFTs · ${formatPrice(stats.volume, 3)} ${stats.currency}` : '—'}
                </p>
            </div>
        </div>
    )
}

export const MarketplacePage = () => {
    const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
    const [sort, setSort] = useState<SortKey>('recent')
    const [view, setView] = useState<'grid' | 'list'>('grid')
    const [searchInput, setSearchInput] = useState('')
    const [search, setSearch] = useState('')

    // Every collection link points here as /?collection=<slug> - from the Collections page and
    // from each NFT's detail page. Nothing read it, so all of them landed on an unfiltered grid
    // that looked identical to the marketplace they came from.
    const [searchParams, setSearchParams] = useSearchParams()
    const collection = searchParams.get('collection') ?? undefined

    const query = useMemo(
        () => ({
            ...filtersToQuery(filters),
            collection,
            sort,
            search: search || undefined,
            limit: PAGE_SIZE,
        }),
        [filters, collection, sort, search]
    )

    const {
        data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage, isFetching,
    } = useInfiniteQuery({
        queryKey: ['nfts', query],
        queryFn: ({ pageParam }) => api.nfts({ ...query, offset: pageParam as number }),
        initialPageParam: 0,
        // Offset paging: the next cursor is however many rows we already hold.
        getNextPageParam: (last, pages) =>
            last.hasMore ? pages.reduce((n, p) => n + p.data.length, 0) : undefined,
        placeholderData: keepPreviousData,
    })

    const nfts = data?.pages.flatMap((p) => p.data) ?? []
    const total = data?.pages[0]?.total ?? 0

    // Only to label the chip; the filtering itself is done by the slug alone.
    const { data: collections } = useQuery({
        queryKey: ['collections'],
        queryFn: () => api.collections(),
        enabled: Boolean(collection),
    })
    const collectionName = collections?.data.find((x) => x.slug === collection)?.name

    return (
        <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
            <div className="mb-6 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-white sm:text-4xl">Marketplace</h1>
                    <p className="mt-2 max-w-xl text-sm text-white/50">
                        Discover, collect, and sell extraordinary NFTs across Solana and Ethereum.
                    </p>
                </div>
                <div className="grid w-full gap-3 sm:grid-cols-2 lg:w-auto lg:min-w-[420px]">
                    <ChainHeroCard chain="SOLANA" />
                    <ChainHeroCard chain="ETHEREUM" />
                </div>
            </div>

            <div className="mb-6">
                <StatsBar />
            </div>

            <div className="flex gap-8">
                <FilterSidebar
                    filters={filters}
                    onChange={setFilters}
                    onClear={() => setFilters(EMPTY_FILTERS)}
                />

                <div className="min-w-0 flex-1">
                    {collection && (
                        <div className="mb-4 flex items-center gap-2">
                            <span className="inline-flex items-center gap-2 rounded-xl bg-indigo-500/15 px-3 py-1.5 text-sm text-indigo-200 ring-1 ring-indigo-400/30">
                                {collectionName ?? 'Collection'}
                                <button
                                    onClick={() => {
                                        // Drop the param rather than the whole query string, so a
                                        // chain or search filter alongside it survives.
                                        searchParams.delete('collection')
                                        setSearchParams(searchParams, { replace: true })
                                    }}
                                    aria-label="Clear collection filter"
                                    className="text-indigo-300/70 transition-colors hover:text-white"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </span>
                        </div>
                    )}

                    <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <ChainTabs
                            value={filters.chain}
                            onChange={(chain) => setFilters({ ...filters, chain })}
                        />

                        <div className="flex flex-wrap items-center gap-2">
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault()
                                    setSearch(searchInput.trim())
                                }}
                                className="relative flex-1 lg:w-64 lg:flex-none"
                            >
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                                <input
                                    value={searchInput}
                                    onChange={(e) => setSearchInput(e.target.value)}
                                    placeholder="Search NFTs"
                                    aria-label="Search NFTs"
                                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/30 focus:border-indigo-400/60 focus:outline-none"
                                />
                            </form>

                            <select
                                value={sort}
                                onChange={(e) => setSort(e.target.value as SortKey)}
                                aria-label="Sort by"
                                className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white focus:border-indigo-400/60 focus:outline-none"
                            >
                                {SORT_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value} className="bg-[#0e1018]">
                                        {o.label}
                                    </option>
                                ))}
                            </select>

                            <div className="flex overflow-hidden rounded-xl border border-white/10">
                                {(['grid', 'list'] as const).map((v) => (
                                    <button
                                        key={v}
                                        onClick={() => setView(v)}
                                        aria-label={`${v} view`}
                                        aria-pressed={view === v}
                                        className={cn(
                                            'p-2 transition-colors',
                                            view === v ? 'bg-indigo-500/25 text-white' : 'text-white/45 hover:text-white'
                                        )}
                                    >
                                        {v === 'grid' ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {!isLoading && !isError && (
                        <p className="mb-4 text-xs text-white/40">
                            {total === 0 ? 'No results' : `${formatCount(total)} ${total === 1 ? 'item' : 'items'}`}
                            {isFetching && !isFetchingNextPage ? ' · updating…' : ''}
                        </p>
                    )}

                    {isError && (
                        <div className="flex items-start gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] p-5">
                            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                            <div>
                                <h3 className="text-sm font-semibold text-white">Could not load NFTs</h3>
                                {/* The real message, not a generic apology - it is usually actionable. */}
                                <p className="mt-1 text-sm text-white/55">{(error as Error)?.message}</p>
                            </div>
                        </div>
                    )}

                    {isLoading && (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                            {Array.from({ length: 10 }).map((_, i) => <NftCardSkeleton key={i} />)}
                        </div>
                    )}

                    {!isLoading && !isError && nfts.length === 0 && (
                        <div className="rounded-2xl border border-white/[0.07] bg-[#0e1018] p-12 text-center">
                            <h3 className="text-sm font-semibold text-white">Nothing matches those filters</h3>
                            <p className="mx-auto mt-1.5 max-w-sm text-sm text-white/45">
                                Try clearing the chain or category filter, or widening the price range.
                            </p>
                            <button
                                onClick={() => {
                                    setFilters(EMPTY_FILTERS)
                                    setSearch('')
                                    setSearchInput('')
                                }}
                                className="mt-4 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-400"
                            >
                                Clear filters
                            </button>
                        </div>
                    )}

                    {nfts.length > 0 && (
                        view === 'grid' ? (
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                                {nfts.map((nft) => <NftCard key={nft.assetId} nft={nft} />)}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {nfts.map((nft) => <NftRow key={nft.assetId} nft={nft} />)}
                            </div>
                        )
                    )}

                    {hasNextPage && (
                        <div className="mt-8 flex justify-center">
                            <button
                                onClick={() => fetchNextPage()}
                                disabled={isFetchingNextPage}
                                className="rounded-xl border border-white/10 bg-white/[0.03] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/[0.07] disabled:opacity-50"
                            >
                                {isFetchingNextPage ? 'Loading…' : 'Load More'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
