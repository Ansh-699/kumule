import type { Chain, Category, NftFilters } from '@/lib/api'

/**
 * Marketplace filter state, and the mapping from it to query parameters.
 *
 * Here rather than in FilterSidebar because none of it renders: it is the shape the URL is
 * built from, and MarketplacePage reads it without touching the sidebar component.
 */
export type Filters = {
    chain?: Chain
    category?: Category
    minPrice: string
    maxPrice: string
    listedOnly: boolean
}

export const EMPTY_FILTERS: Filters = {
    chain: undefined,
    category: undefined,
    minPrice: '',
    maxPrice: '',
    listedOnly: false,
}

/**
 * A half-typed price is not a filter. The input sanitizer permits a bare "." (it strips
 * non-digits but cannot require a digit), and sending that to the API meant
 * `new Prisma.Decimal(".")`, which throws - the request came back 500 while the user was
 * still typing.
 *
 * ".5" and "5." are not half-typed, though; they are how people write 0.5 and 5, and both
 * already worked because Prisma's Decimal accepts them. They are normalised rather than
 * discarded - dropping them would silently ignore a filter the user did set, which is a
 * quieter bug than the 500 it replaced.
 */
const asDecimalOrUndefined = (value: string): string | undefined => {
    const v = value.trim()
    // No digit at all means nothing has been typed yet: "", ".", "..".
    if (!/\d/.test(v)) return undefined
    const canonical = v.replace(/^\./, '0.').replace(/\.$/, '')
    return /^\d+(\.\d+)?$/.test(canonical) ? canonical : undefined
}

export const filtersToQuery = (f: Filters): NftFilters => ({
    chain: f.chain,
    category: f.category,
    // Left as strings all the way to the API: prices are decimal strings end to end.
    minPrice: asDecimalOrUndefined(f.minPrice),
    maxPrice: asDecimalOrUndefined(f.maxPrice),
    listedOnly: f.listedOnly || undefined,
})

export const activeFilterCount = (f: Filters): number =>
    [f.chain, f.category, asDecimalOrUndefined(f.minPrice), asDecimalOrUndefined(f.maxPrice), f.listedOnly || undefined]
        .filter(Boolean).length
