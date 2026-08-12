import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { Trophy, Medal, AlertCircle, CheckCircle2, Loader2, ExternalLink, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api, type EventSummary, type Medal as MedalType } from '@/lib/api'
import { TIER_UI } from '@/lib/chain-ui'

/**
 * Events and medal claiming.
 *
 * The API computes claimability per medal, so this file never re-derives the rules: it renders
 * `claimable` and `reason` as given. Duplicating the threshold logic here is how a UI ends up
 * offering a button the backend will reject.
 */

const MedalCard = ({
    medal, eventId, wallet, joined,
}: { medal: MedalType; eventId: string; wallet: string | null; joined: boolean }) => {
    const tier = TIER_UI[medal.tier]
    const queryClient = useQueryClient()
    const [result, setResult] = useState<{ ok: boolean; message: string; url?: string } | null>(null)

    const claim = useMutation({
        mutationFn: () => api.claimMedal(eventId, medal.id, wallet!),
        onSuccess: (r) => {
            setResult({ ok: true, message: `${r.tier} medal is now in your wallet`, url: r.explorerUrl })
            queryClient.invalidateQueries({ queryKey: ['event', eventId] })
        },
        // The API's message is specific (not enough points, supply exhausted, vault unset), so
        // it is shown verbatim rather than replaced with something generic.
        onError: (e: Error) => setResult({ ok: false, message: e.message }),
    })

    const progress = medal.requiredPoints === 0
        ? 100
        : Math.min(100, Math.round(((medal.requiredPoints - medal.pointsNeeded) / medal.requiredPoints) * 100))

    return (
        <div className={cn('rounded-2xl border border-white/[0.07] bg-[#0e1018] p-5 ring-1', tier.ring)}>
            <div className="flex items-start gap-3">
                <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', tier.bg)}>
                    <Medal className={cn('h-5 w-5', tier.text)} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-white">{medal.name}</h3>
                        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', tier.bg, tier.text)}>
                            {tier.label}
                        </span>
                    </div>
                    <p className="mt-0.5 text-xs text-white/45">
                        {medal.requiredPoints} points · {medal.remaining} of {medal.supply} left
                    </p>
                </div>
            </div>

            {medal.imageUrl && (
                <img
                    src={medal.imageUrl}
                    alt={medal.name}
                    loading="lazy"
                    className="mt-4 aspect-square w-full rounded-xl object-cover"
                />
            )}

            <div className="mt-4">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                        className={cn('h-full rounded-full transition-all', medal.eligible ? 'bg-emerald-400' : 'bg-indigo-400')}
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <p className="mt-1.5 text-[11px] text-white/40">
                    {medal.claimed
                        ? 'Claimed'
                        : medal.eligible
                            ? 'Threshold reached'
                            : `${medal.pointsNeeded} more points needed`}
                </p>
            </div>

            {result && (
                <div
                    className={cn(
                        'mt-3 flex items-start gap-2 rounded-xl p-2.5 text-xs',
                        result.ok ? 'bg-emerald-500/10 text-emerald-200' : 'bg-red-500/10 text-red-200'
                    )}
                    role="status"
                >
                    {result.ok ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    ) : (
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="min-w-0">
                        {result.message}
                        {result.url && (
                            <a
                                href={result.url}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-1 inline-flex items-center gap-1 underline"
                            >
                                view <ExternalLink className="h-3 w-3" />
                            </a>
                        )}
                    </span>
                </div>
            )}

            <button
                onClick={() => claim.mutate()}
                disabled={!wallet || !joined || !medal.claimable || claim.isPending || medal.claimed}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-white/[0.05] disabled:text-white/40"
            >
                {claim.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {!wallet
                    ? 'Connect a Solana wallet'
                    : !joined
                        ? 'Join the event first'
                        : medal.claimed
                            ? 'Claimed'
                            : medal.claimable
                                ? 'Claim medal'
                                : (medal.reason ?? 'Not claimable')}
                {!medal.claimable && !medal.claimed && joined && wallet && <Lock className="h-3.5 w-3.5" />}
            </button>
        </div>
    )
}

const EventPanel = ({ event, wallet }: { event: EventSummary; wallet: string | null }) => {
    const queryClient = useQueryClient()
    const { data: detail } = useQuery({
        queryKey: ['event', event.id, wallet],
        queryFn: () => api.event(event.id, wallet ?? undefined),
    })

    const join = useMutation({
        mutationFn: () => api.joinEvent(event.id, wallet!),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['event', event.id] }),
    })

    const you = detail?.you
    const medals = detail?.medals ?? event.medals

    return (
        <section className="rounded-2xl border border-white/[0.07] bg-[#0b0d13] p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-white">{event.name}</h2>
                        <span
                            className={cn(
                                'rounded px-2 py-0.5 text-[10px] font-semibold uppercase',
                                event.status === 'ACTIVE'
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : 'bg-white/[0.06] text-white/50'
                            )}
                        >
                            {event.status}
                        </span>
                    </div>
                    {event.description && <p className="mt-1.5 max-w-2xl text-sm text-white/55">{event.description}</p>}
                    <p className="mt-2 text-xs text-white/40">
                        {event.participants} participants · {event.claims} medals claimed
                    </p>
                </div>

                <div className="shrink-0 text-right">
                    {you?.joined ? (
                        <>
                            <div className="text-2xl font-bold text-white">{you.points}</div>
                            <div className="text-xs text-white/40">your points</div>
                        </>
                    ) : (
                        <button
                            onClick={() => join.mutate()}
                            disabled={!wallet || join.isPending || event.status !== 'ACTIVE'}
                            className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:bg-white/[0.05] disabled:text-white/40"
                        >
                            {join.isPending ? 'Joining…' : wallet ? 'Join event' : 'Connect wallet'}
                        </button>
                    )}
                </div>
            </div>

            {join.isError && (
                <p className="mt-3 text-xs text-red-300">{(join.error as Error).message}</p>
            )}

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {medals.map((m) => (
                    <MedalCard
                        key={m.id}
                        medal={m}
                        eventId={event.id}
                        wallet={wallet}
                        joined={Boolean(you?.joined)}
                    />
                ))}
            </div>
        </section>
    )
}

export const EventsPage = () => {
    const solana = useWallet()
    const wallet = solana.publicKey?.toBase58() ?? null

    const { data, isLoading, isError, error } = useQuery({
        queryKey: ['events'],
        queryFn: () => api.events(),
    })

    const events = data?.data ?? []

    return (
        <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/10">
                    <Trophy className="h-5 w-5 text-amber-300" />
                </span>
                <div>
                    <h1 className="text-3xl font-bold text-white">Events & Medals</h1>
                    <p className="mt-1 text-sm text-white/50">
                        Complete tasks, earn points, and claim medal NFTs straight to your wallet.
                    </p>
                </div>
            </div>

            <p className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5 text-xs text-white/45">
                Medals are minted on Solana devnet and held by the marketplace vault until claimed. Points
                are awarded by an event admin.
            </p>

            {isError && (
                <div className="mt-6 flex items-start gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] p-5">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                    <div>
                        <h3 className="text-sm font-semibold text-white">Could not load events</h3>
                        <p className="mt-1 text-sm text-white/55">{(error as Error)?.message}</p>
                    </div>
                </div>
            )}

            {isLoading && (
                <div className="mt-6 space-y-4">
                    {Array.from({ length: 2 }).map((_, i) => (
                        <div key={i} className="h-64 animate-pulse rounded-2xl bg-white/[0.03]" />
                    ))}
                </div>
            )}

            {!isLoading && !isError && events.length === 0 && (
                <div className="mt-6 rounded-2xl border border-white/[0.07] bg-[#0e1018] p-12 text-center">
                    <Trophy className="mx-auto h-8 w-8 text-white/25" />
                    <h3 className="mt-3 text-sm font-semibold text-white">No events running</h3>
                    <p className="mx-auto mt-1.5 max-w-sm text-sm text-white/45">
                        An admin creates events and configures the Gold, Silver and Bronze medals for each.
                    </p>
                </div>
            )}

            <div className="mt-6 space-y-6">
                {events.map((e) => (
                    <EventPanel key={e.id} event={e} wallet={wallet} />
                ))}
            </div>
        </div>
    )
}
