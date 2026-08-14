import { useState } from 'react'
import { X, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ChainMark } from './ChainBadge'
import { CATEGORIES, CHAIN_UI } from '@/lib/chain-ui'
import { activeFilterCount, type Filters } from '@/lib/filters'
import type { Chain, Category } from '@/lib/api'

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="border-b border-white/[0.06] py-5">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">{title}</h3>
        {children}
    </div>
)

const Check = ({
    checked, onChange, children,
}: { checked: boolean; onChange: () => void; children: React.ReactNode }) => (
    <label className="flex cursor-pointer items-center gap-2.5 py-1.5 text-sm text-white/70 transition-colors hover:text-white">
        <span
            className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                checked ? 'border-indigo-400 bg-indigo-500' : 'border-white/20 bg-transparent'
            )}
        >
            {checked && (
                <svg viewBox="0 0 12 12" className="h-3 w-3 text-white" aria-hidden="true">
                    <path d="M2.5 6.2 4.7 8.4 9.5 3.6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                </svg>
            )}
        </span>
        {/* The visual box above is decorative; this is the real control. */}
        <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
        {children}
    </label>
)

const Body = ({
    filters, onChange, onClear,
}: { filters: Filters; onChange: (f: Filters) => void; onClear: () => void }) => {
    const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
        onChange({ ...filters, [key]: value })

    // Only digits and a single point: a price field should not accept "1e9" or "--".
    const priceInput = (value: string) => value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')

    return (
        <div className="divide-y divide-white/[0.06]">
            <div className="flex items-center justify-between pb-4">
                <h2 className="text-sm font-semibold text-white">Filters</h2>
                <button
                    onClick={onClear}
                    className="text-xs text-indigo-400 transition-colors hover:text-indigo-300"
                >
                    Clear all
                </button>
            </div>

            <Section title="Chain">
                <div className="space-y-1">
                    {(['SOLANA', 'ETHEREUM'] as Chain[]).map((chain) => (
                        <Check
                            key={chain}
                            checked={filters.chain === chain}
                            // Selecting the active chain clears it, so the pair behaves like
                            // "all chains" rather than trapping you in one.
                            onChange={() => set('chain', filters.chain === chain ? undefined : chain)}
                        >
                            <span className="flex items-center gap-2">
                                <ChainMark chain={chain} className={cn('h-4 w-4', CHAIN_UI[chain].accent)} />
                                {CHAIN_UI[chain].label}
                            </span>
                        </Check>
                    ))}
                </div>
            </Section>

            <Section title="Category">
                <div className="space-y-1">
                    {CATEGORIES.map((cat) => (
                        <Check
                            key={cat.value}
                            checked={filters.category === cat.value}
                            onChange={() =>
                                set('category', filters.category === cat.value ? undefined : (cat.value as Category))
                            }
                        >
                            {cat.label}
                        </Check>
                    ))}
                </div>
            </Section>

            <Section title="Price">
                <div className="flex items-center gap-2">
                    <input
                        value={filters.minPrice}
                        onChange={(e) => set('minPrice', priceInput(e.target.value))}
                        placeholder="Min"
                        inputMode="decimal"
                        aria-label="Minimum price"
                        className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-indigo-400/60 focus:outline-none"
                    />
                    <span className="text-xs text-white/30">to</span>
                    <input
                        value={filters.maxPrice}
                        onChange={(e) => set('maxPrice', priceInput(e.target.value))}
                        placeholder="Max"
                        inputMode="decimal"
                        aria-label="Maximum price"
                        className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-indigo-400/60 focus:outline-none"
                    />
                </div>
                {filters.chain ? (
                    <p className="mt-2 text-[11px] text-white/35">
                        In {CHAIN_UI[filters.chain].currency}
                    </p>
                ) : (
                    // Without a chain filter, SOL and ETH sit in one list and a bare number is
                    // ambiguous. Say so rather than quietly comparing across currencies.
                    <p className="mt-2 text-[11px] text-amber-300/70">
                        Pick a chain for prices to compare meaningfully
                    </p>
                )}
            </Section>

            <Section title="Status">
                <Check checked={filters.listedOnly} onChange={() => set('listedOnly', !filters.listedOnly)}>
                    Buy now
                </Check>
            </Section>
        </div>
    )
}

/** Persistent rail on desktop, slide-over on mobile. */
export const FilterSidebar = (props: {
    filters: Filters
    onChange: (f: Filters) => void
    onClear: () => void
}) => {
    const [open, setOpen] = useState(false)
    const count = activeFilterCount(props.filters)

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm text-white/80 lg:hidden"
            >
                <SlidersHorizontal className="h-4 w-4" />
                Filters
                {count > 0 && (
                    <span className="rounded-full bg-indigo-500 px-1.5 text-[11px] font-semibold text-white">
                        {count}
                    </span>
                )}
            </button>

            <aside className="hidden w-60 shrink-0 lg:block">
                <div className="sticky top-24 px-1">
                    <Body {...props} />
                </div>
            </aside>

            {open && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div
                        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                        onClick={() => setOpen(false)}
                        aria-hidden="true"
                    />
                    <div className="absolute inset-y-0 left-0 w-[85%] max-w-sm overflow-y-auto border-r border-white/10 bg-[#0b0d13] p-5">
                        <button
                            onClick={() => setOpen(false)}
                            className="mb-2 ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-white/60 hover:bg-white/5"
                            aria-label="Close filters"
                        >
                            <X className="h-4 w-4" />
                        </button>
                        <Body {...props} />
                    </div>
                </div>
            )}
        </>
    )
}
