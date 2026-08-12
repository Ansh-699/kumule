import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
    ShieldCheck, AlertCircle, Users, Image as ImageIcon, Tag, Receipt, Trophy,
    EyeOff, Eye, Loader2, ExternalLink, Coins,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { adminApi, type Chain } from '@/lib/api'
import { CHAIN_UI, formatPrice, formatCount, shortAddress, relativeTime } from '@/lib/chain-ui'
import { ChainBadge, ChainMark } from '@/components/ChainBadge'

/**
 * Admin dashboard.
 *
 * The key is held in component state only, never localStorage: it grants full read access to
 * every user and wallet, and persisting it means any XSS on this origin walks away with it.
 * Re-entering it per session is the correct trade.
 */

const TABS = ['overview', 'users', 'listings', 'transactions', 'events', 'broken'] as const
type Tab = (typeof TABS)[number]

const TAB_META: Record<Tab, { label: string; icon: typeof Users }> = {
    overview: { label: 'Overview', icon: ShieldCheck },
    users: { label: 'Users', icon: Users },
    listings: { label: 'Listings', icon: Tag },
    transactions: { label: 'Transactions', icon: Receipt },
    events: { label: 'Events', icon: Trophy },
    broken: { label: 'Broken images', icon: ImageIcon },
}

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="rounded-2xl border border-white/[0.07] bg-[#0e1018] p-5">
        <h3 className="mb-4 text-sm font-semibold text-white">{title}</h3>
        {children}
    </div>
)

const Metric = ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-2xl font-bold text-white">{typeof value === 'number' ? formatCount(value) : value}</div>
        <div className="mt-0.5 text-xs text-white/45">{label}</div>
        {hint && <div className="mt-1 text-[11px] text-amber-300/70">{hint}</div>}
    </div>
)

const Table = ({ head, children }: { head: string[]; children: React.ReactNode }) => (
    <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
                <tr className="border-b border-white/[0.08]">
                    {head.map((h) => (
                        <th key={h} className="pb-2 pr-4 text-[11px] font-medium uppercase tracking-wider text-white/40">
                            {h}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">{children}</tbody>
        </table>
    </div>
)

const ErrorBox = ({ error }: { error: unknown }) => (
    <div className="flex items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/[0.06] p-4">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
        <p className="text-sm text-white/70">{(error as Error)?.message ?? 'Request failed'}</p>
    </div>
)

// ---------------------------------------------------------------- tabs

const Overview = ({ admin }: { admin: ReturnType<typeof adminApi> }) => {
    const { data, isLoading, isError, error } = useQuery({
        queryKey: ['admin-overview'],
        queryFn: () => admin.overview(),
    })

    if (isError) return <ErrorBox error={error} />
    if (isLoading || !data) return <div className="h-64 animate-pulse rounded-2xl bg-white/[0.03]" />

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <Metric label="Users" value={data.totals.users} />
                <Metric label="Wallets" value={data.totals.wallets} />
                <Metric label="NFTs" value={data.totals.nfts} />
                <Metric label="Active listings" value={data.totals.activeListings} />
                <Metric label="Sales" value={data.totals.sales} />
                <Metric label="Collections" value={data.totals.collections} />
                <Metric label="Events" value={data.totals.events} />
                <Metric label="Medal claims" value={data.totals.medalClaims} />
                <Metric label="Hidden NFTs" value={data.totals.hiddenNfts} />
                <Metric
                    label="Missing images"
                    value={data.totals.nftsMissingImages}
                    hint={data.totals.nftsMissingImages > 0 ? 'needs triage' : undefined}
                />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                {(['SOLANA', 'ETHEREUM'] as Chain[]).map((chain) => {
                    const c = data.chains[chain]
                    return (
                        <Panel key={chain} title={`${c.label} · ${CHAIN_UI[chain].network}`}>
                            <div className="mb-3 flex items-center gap-2">
                                <ChainBadge chain={chain} variant="pill" />
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <div className="text-white/40">NFTs</div>
                                    <div className="font-semibold text-white">{formatCount(c.nfts)}</div>
                                </div>
                                <div>
                                    <div className="text-white/40">Wallets</div>
                                    <div className="font-semibold text-white">{formatCount(c.wallets)}</div>
                                </div>
                                <div>
                                    <div className="text-white/40">Listed value</div>
                                    <div className="font-semibold text-white">
                                        {formatPrice(c.listedValue)} {c.currency}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-white/40">Volume</div>
                                    <div className="font-semibold text-white">
                                        {formatPrice(c.volume)} {c.currency}
                                    </div>
                                </div>
                            </div>
                        </Panel>
                    )
                })}
            </div>

            <Panel title="Category distribution">
                <div className="space-y-2">
                    {data.categories.map((cat) => {
                        const max = Math.max(...data.categories.map((x) => x.count), 1)
                        return (
                            <div key={cat.category} className="flex items-center gap-3 text-sm">
                                <span className="w-32 shrink-0 truncate text-white/55">
                                    {cat.category.replace(/_/g, ' ')}
                                </span>
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                                    <div
                                        className="h-full rounded-full bg-indigo-400"
                                        style={{ width: `${(cat.count / max) * 100}%` }}
                                    />
                                </div>
                                <span className="w-10 shrink-0 text-right text-white/70">{cat.count}</span>
                            </div>
                        )
                    })}
                    {data.categories.length === 0 && <p className="text-sm text-white/40">No NFTs indexed yet.</p>}
                </div>
            </Panel>

            <Panel title="Recent transactions">
                {data.recentTransactions.length === 0 ? (
                    <p className="text-sm text-white/40">Nothing recorded yet.</p>
                ) : (
                    <Table head={['Chain', 'Kind', 'Status', 'Wallet', 'Amount', 'When']}>
                        {data.recentTransactions.map((t) => (
                            <tr key={t.id}>
                                <td className="py-2.5 pr-4">
                                    <ChainMark chain={t.chain} className={cn('h-4 w-4', CHAIN_UI[t.chain].accent)} />
                                </td>
                                <td className="py-2.5 pr-4 text-white/80">{t.kind}</td>
                                <td className="py-2.5 pr-4">
                                    <span
                                        className={cn(
                                            'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                            t.status === 'CONFIRMED'
                                                ? 'bg-emerald-500/15 text-emerald-300'
                                                : t.status === 'FAILED'
                                                    ? 'bg-red-500/15 text-red-300'
                                                    : 'bg-amber-500/15 text-amber-300'
                                        )}
                                    >
                                        {t.status}
                                    </span>
                                </td>
                                <td className="py-2.5 pr-4 text-white/60">{shortAddress(t.walletAddress)}</td>
                                <td className="py-2.5 pr-4 text-white/80">
                                    {t.amount ? `${formatPrice(t.amount)} ${t.currency ?? ''}` : '—'}
                                </td>
                                <td className="py-2.5 pr-4 text-white/45">
                                    {relativeTime(t.createdAt)}
                                    {t.explorerUrl && (
                                        <a href={t.explorerUrl} target="_blank" rel="noreferrer" className="ml-1.5 inline-block text-indigo-300">
                                            <ExternalLink className="inline h-3 w-3" />
                                        </a>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </Table>
                )}
            </Panel>
        </div>
    )
}

const UsersTab = ({ admin }: { admin: ReturnType<typeof adminApi> }) => {
    const { data, isLoading, isError, error } = useQuery({
        queryKey: ['admin-users'],
        queryFn: () => admin.users({ limit: 100 }),
    })
    if (isError) return <ErrorBox error={error} />
    if (isLoading || !data) return <div className="h-64 animate-pulse rounded-2xl bg-white/[0.03]" />

    return (
        <Panel title={`Users (${data.total})`}>
            <Table head={['Wallets', 'Likes', 'Events', 'Claims', 'Joined']}>
                {data.data.map((u) => (
                    <tr key={u.id}>
                        <td className="py-2.5 pr-4">
                            <div className="flex flex-col gap-1">
                                {u.wallets.map((w) => (
                                    <a
                                        key={`${w.chain}-${w.address}`}
                                        href={w.explorerUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1.5 text-white/75 hover:text-white"
                                    >
                                        <ChainMark chain={w.chain} className={cn('h-3.5 w-3.5', CHAIN_UI[w.chain].accent)} />
                                        {shortAddress(w.address, 6, 6)}
                                    </a>
                                ))}
                                {u.wallets.length === 0 && <span className="text-white/35">no wallets</span>}
                            </div>
                        </td>
                        <td className="py-2.5 pr-4 text-white/70">{u.counts.likes ?? 0}</td>
                        <td className="py-2.5 pr-4 text-white/70">{u.counts.participants ?? 0}</td>
                        <td className="py-2.5 pr-4 text-white/70">{u.counts.claims ?? 0}</td>
                        <td className="py-2.5 pr-4 text-white/45">{relativeTime(u.createdAt)}</td>
                    </tr>
                ))}
            </Table>
        </Panel>
    )
}

const ListingsTab = ({ admin }: { admin: ReturnType<typeof adminApi> }) => {
    const [chain, setChain] = useState<Chain | undefined>()
    const { data, isLoading, isError, error } = useQuery({
        queryKey: ['admin-listings', chain],
        queryFn: () => admin.listings({ chain, limit: 100 }),
    })

    return (
        <Panel title="Listings">
            <div className="mb-4 flex gap-2">
                {([undefined, 'SOLANA', 'ETHEREUM'] as const).map((c) => (
                    <button
                        key={c ?? 'all'}
                        onClick={() => setChain(c)}
                        className={cn(
                            'rounded-lg px-3 py-1.5 text-xs font-medium',
                            chain === c ? 'bg-indigo-500/20 text-white' : 'bg-white/[0.03] text-white/55'
                        )}
                    >
                        {c ? CHAIN_UI[c].label : 'All'}
                    </button>
                ))}
            </div>

            {isError ? <ErrorBox error={error} /> : isLoading || !data ? (
                <div className="h-40 animate-pulse rounded-xl bg-white/[0.03]" />
            ) : data.data.length === 0 ? (
                <p className="text-sm text-white/40">No listings.</p>
            ) : (
                <Table head={['Chain', 'NFT', 'Price', 'Status', 'Seller', 'Created']}>
                    {data.data.map((l) => (
                        <tr key={l.id}>
                            <td className="py-2.5 pr-4">
                                <ChainMark chain={l.chain} className={cn('h-4 w-4', CHAIN_UI[l.chain].accent)} />
                            </td>
                            <td className="py-2.5 pr-4 max-w-[200px] truncate text-white/80">{l.nft.name}</td>
                            <td className="py-2.5 pr-4 font-medium text-white">
                                {formatPrice(l.price)} {l.currency}
                            </td>
                            <td className="py-2.5 pr-4">
                                <span
                                    className={cn(
                                        'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                        l.status === 'ACTIVE'
                                            ? 'bg-emerald-500/15 text-emerald-300'
                                            : l.status === 'SOLD'
                                                ? 'bg-indigo-500/15 text-indigo-300'
                                                : 'bg-white/[0.06] text-white/45'
                                    )}
                                >
                                    {l.status}
                                </span>
                            </td>
                            <td className="py-2.5 pr-4 text-white/60">{shortAddress(l.sellerAddress)}</td>
                            <td className="py-2.5 pr-4 text-white/45">{relativeTime(l.createdAt)}</td>
                        </tr>
                    ))}
                </Table>
            )}
        </Panel>
    )
}

const TransactionsTab = ({ admin }: { admin: ReturnType<typeof adminApi> }) => {
    const { data, isLoading, isError, error } = useQuery({
        queryKey: ['admin-transactions'],
        queryFn: () => admin.transactions({ limit: 100 }),
    })
    if (isError) return <ErrorBox error={error} />
    if (isLoading || !data) return <div className="h-64 animate-pulse rounded-2xl bg-white/[0.03]" />

    return (
        <Panel title={`Transactions (${data.total})`}>
            {data.data.length === 0 ? (
                <p className="text-sm text-white/40">Nothing recorded yet.</p>
            ) : (
                <Table head={['Chain', 'Kind', 'Status', 'Wallet', 'Amount', 'Tx', 'When']}>
                    {data.data.map((t) => (
                        <tr key={t.id}>
                            <td className="py-2.5 pr-4">
                                <ChainMark chain={t.chain} className={cn('h-4 w-4', CHAIN_UI[t.chain].accent)} />
                            </td>
                            <td className="py-2.5 pr-4 text-white/80">{t.kind}</td>
                            <td className="py-2.5 pr-4 text-white/60">{t.status}</td>
                            <td className="py-2.5 pr-4 text-white/60">{shortAddress(t.walletAddress)}</td>
                            <td className="py-2.5 pr-4 text-white/80">
                                {t.amount ? `${formatPrice(t.amount)} ${t.currency ?? ''}` : '—'}
                            </td>
                            <td className="py-2.5 pr-4">
                                {t.explorerUrl ? (
                                    <a href={t.explorerUrl} target="_blank" rel="noreferrer" className="text-indigo-300">
                                        {shortAddress(t.txHash, 4, 4)}
                                    </a>
                                ) : (
                                    <span className="text-white/30">—</span>
                                )}
                            </td>
                            <td className="py-2.5 pr-4 text-white/45">{relativeTime(t.createdAt)}</td>
                        </tr>
                    ))}
                </Table>
            )}
        </Panel>
    )
}

const BrokenTab = ({ admin }: { admin: ReturnType<typeof adminApi> }) => {
    const queryClient = useQueryClient()
    const { data, isLoading, isError, error } = useQuery({
        queryKey: ['admin-broken'],
        queryFn: () => admin.brokenNfts({ limit: 100 }),
    })

    const toggle = useMutation({
        mutationFn: ({ assetId, hidden }: { assetId: string; hidden: boolean }) =>
            admin.setHidden(assetId, hidden),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-broken'] }),
    })

    if (isError) return <ErrorBox error={error} />
    if (isLoading || !data) return <div className="h-64 animate-pulse rounded-2xl bg-white/[0.03]" />

    return (
        <Panel title={`Assets with unresolved images (${data.total})`}>
            <p className="mb-4 text-xs text-white/45">
                Hidden assets stay out of the marketplace but are never deleted — an asset exists on chain
                regardless, and its metadata host may come back.
            </p>
            {data.data.length === 0 ? (
                <p className="text-sm text-emerald-300">Every indexed asset has a resolvable image.</p>
            ) : (
                <Table head={['Chain', 'Name', 'Metadata URI', 'Owner', 'Hidden', '']}>
                    {data.data.map((n) => (
                        <tr key={n.assetId}>
                            <td className="py-2.5 pr-4">
                                <ChainMark chain={n.chain} className={cn('h-4 w-4', CHAIN_UI[n.chain].accent)} />
                            </td>
                            <td className="py-2.5 pr-4 max-w-[160px] truncate text-white/80">{n.name}</td>
                            <td className="py-2.5 pr-4 max-w-[260px] truncate text-white/45">
                                {n.metadataUri ?? '—'}
                            </td>
                            <td className="py-2.5 pr-4 text-white/60">{shortAddress(n.ownerAddress)}</td>
                            <td className="py-2.5 pr-4">{n.hidden ? 'yes' : 'no'}</td>
                            <td className="py-2.5">
                                <button
                                    onClick={() => toggle.mutate({ assetId: n.assetId, hidden: !n.hidden })}
                                    disabled={toggle.isPending}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/70 hover:bg-white/5 disabled:opacity-50"
                                >
                                    {n.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                                    {n.hidden ? 'Unhide' : 'Hide'}
                                </button>
                            </td>
                        </tr>
                    ))}
                </Table>
            )}
        </Panel>
    )
}

const EventsTab = ({ admin }: { admin: ReturnType<typeof adminApi> }) => {
    const queryClient = useQueryClient()
    const [name, setName] = useState('')
    const [grant, setGrant] = useState({ eventId: '', wallet: '', points: '10' })

    const { data } = useQuery({
        queryKey: ['admin-events'],
        // Reuses the public list; events are not secret, only the mutations are.
        queryFn: async () => (await fetch(`${import.meta.env.VITE_API_BASE ?? 'https://kumele-backend.ansht.workers.dev'}/api/events`)).json(),
    })

    const create = useMutation({
        mutationFn: () => admin.createEvent({ name }),
        onSuccess: () => {
            setName('')
            queryClient.invalidateQueries({ queryKey: ['admin-events'] })
        },
    })

    const mint = useMutation({
        mutationFn: (eventId: string) => admin.mintMedals(eventId),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-events'] }),
    })

    const points = useMutation({
        mutationFn: () =>
            admin.grantPoints(grant.eventId, grant.wallet, parseInt(grant.points, 10), 'admin dashboard'),
    })

    const events = data?.data ?? []

    return (
        <div className="space-y-6">
            <Panel title="Create an event">
                <div className="flex gap-2">
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Event name"
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30"
                    />
                    <button
                        onClick={() => create.mutate()}
                        disabled={!name || create.isPending}
                        className="shrink-0 rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white disabled:opacity-50"
                    >
                        {create.isPending ? 'Creating…' : 'Create'}
                    </button>
                </div>
                <p className="mt-2 text-[11px] text-white/40">
                    Creates Gold (100 pts), Silver (60) and Bronze (30) with default supplies. Thresholds must
                    stay GOLD ≥ SILVER ≥ BRONZE.
                </p>
                {create.isError && <p className="mt-2 text-xs text-red-300">{(create.error as Error).message}</p>}
            </Panel>

            <Panel title="Grant points (mocked)">
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_100px_auto]">
                    <select
                        value={grant.eventId}
                        onChange={(e) => setGrant({ ...grant, eventId: e.target.value })}
                        className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white"
                    >
                        <option value="">Select event</option>
                        {events.map((e: any) => (
                            <option key={e.id} value={e.id} className="bg-[#0e1018]">{e.name}</option>
                        ))}
                    </select>
                    <input
                        value={grant.wallet}
                        onChange={(e) => setGrant({ ...grant, wallet: e.target.value })}
                        placeholder="Solana wallet"
                        className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30"
                    />
                    <input
                        value={grant.points}
                        onChange={(e) => setGrant({ ...grant, points: e.target.value.replace(/[^\d-]/g, '') })}
                        className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white"
                    />
                    <button
                        onClick={() => points.mutate()}
                        disabled={!grant.eventId || !grant.wallet || points.isPending}
                        className="rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white disabled:opacity-50"
                    >
                        Grant
                    </button>
                </div>
                <p className="mt-2 text-[11px] text-amber-300/70">
                    Points are unverified by design and convert directly into an NFT leaving the vault, which
                    is why this endpoint is admin-only.
                </p>
                {points.isError && <p className="mt-2 text-xs text-red-300">{(points.error as Error).message}</p>}
                {points.isSuccess && <p className="mt-2 text-xs text-emerald-300">Points updated.</p>}
            </Panel>

            <Panel title="Events">
                {events.length === 0 ? (
                    <p className="text-sm text-white/40">No events yet.</p>
                ) : (
                    <div className="space-y-3">
                        {events.map((e: any) => (
                            <div key={e.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <h4 className="text-sm font-semibold text-white">{e.name}</h4>
                                        <p className="text-xs text-white/45">
                                            {e.participants} participants · {e.claims} claims ·{' '}
                                            {e.medals.filter((m: any) => m.minted).length}/{e.medals.length} medals minted
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => mint.mutate(e.id)}
                                        disabled={mint.isPending}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/80 hover:bg-white/5 disabled:opacity-50"
                                    >
                                        {mint.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Coins className="h-3.5 w-3.5" />}
                                        Mint medals to vault
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {mint.isError && <p className="mt-3 text-xs text-red-300">{(mint.error as Error).message}</p>}
            </Panel>
        </div>
    )
}

// ---------------------------------------------------------------- shell

export const AdminPage = () => {
    const [keyInput, setKeyInput] = useState('')
    const [key, setKey] = useState<string | null>(null)
    const [tab, setTab] = useState<Tab>('overview')

    if (!key) {
        return (
            <div className="mx-auto max-w-md px-4 py-20">
                <div className="rounded-2xl border border-white/[0.07] bg-[#0e1018] p-6">
                    <ShieldCheck className="h-8 w-8 text-indigo-300" />
                    <h1 className="mt-4 text-xl font-bold text-white">Admin access</h1>
                    <p className="mt-1.5 text-sm text-white/50">
                        Enter the admin API key. It is held in memory for this session only, never stored.
                    </p>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault()
                            if (keyInput.trim()) setKey(keyInput.trim())
                        }}
                        className="mt-5 space-y-3"
                    >
                        <input
                            type="password"
                            value={keyInput}
                            onChange={(e) => setKeyInput(e.target.value)}
                            placeholder="X-Admin-API-Key"
                            autoComplete="off"
                            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-indigo-400/60 focus:outline-none"
                        />
                        <button
                            type="submit"
                            disabled={!keyInput.trim()}
                            className="w-full rounded-xl bg-indigo-500 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                        >
                            Continue
                        </button>
                    </form>
                </div>
            </div>
        )
    }

    const admin = adminApi(key)

    return (
        <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8">
            <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/10">
                        <ShieldCheck className="h-5 w-5 text-indigo-300" />
                    </span>
                    <div>
                        <h1 className="text-2xl font-bold text-white">Admin</h1>
                        <p className="text-xs text-white/45">Solana devnet · Base Sepolia</p>
                    </div>
                </div>
                <button
                    onClick={() => {
                        setKey(null)
                        setKeyInput('')
                    }}
                    className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60 hover:bg-white/5"
                >
                    Lock
                </button>
            </div>

            <div className="mb-6 flex gap-1 overflow-x-auto border-b border-white/[0.07] pb-px">
                {TABS.map((t) => {
                    const { label, icon: Icon } = TAB_META[t]
                    return (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={cn(
                                'inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors',
                                tab === t
                                    ? 'border-indigo-400 text-white'
                                    : 'border-transparent text-white/50 hover:text-white'
                            )}
                        >
                            <Icon className="h-4 w-4" />
                            {label}
                        </button>
                    )
                })}
            </div>

            {tab === 'overview' && <Overview admin={admin} />}
            {tab === 'users' && <UsersTab admin={admin} />}
            {tab === 'listings' && <ListingsTab admin={admin} />}
            {tab === 'transactions' && <TransactionsTab admin={admin} />}
            {tab === 'events' && <EventsTab admin={admin} />}
            {tab === 'broken' && <BrokenTab admin={admin} />}
        </div>
    )
}
