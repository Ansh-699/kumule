// Resolving an NFT's metadata JSON into the columns the marketplace renders from.
//
// A mint stores metadataUri, but the grid needs imageUrl, description and category. Nothing was
// reading the JSON, so every freshly minted asset landed with imageUrl null and category OTHER
// and rendered as "No image available" - while the metadata sitting at that URI had all three.
//
// Resolution happens server-side rather than trusting values from the client: the metadata URI
// is the authoritative record of what the token points at, and it is what any other marketplace
// will read too.

const FETCH_TIMEOUT_MS = 8_000

/**
 * Our own CDN paths, which must be read from R2 directly rather than over HTTP.
 *
 * A Worker cannot fetch its own hostname - the subrequest never reaches the route - so
 * fetching https://<this-worker>/cdn/metadata/x.json returned 404 even though the object was
 * there and curl served it fine. Reading the bucket is also one hop instead of two.
 */
const CDN_METADATA = '/cdn/metadata/'
const CDN_IMAGES = '/cdn/images/'

const r2KeyFor = (uri: string): { bucketKey: string } | null => {
    let path: string
    try {
        path = new URL(uri).pathname
    } catch {
        return null
    }
    if (path.startsWith(CDN_METADATA)) {
        return { bucketKey: `metadata/${path.slice(CDN_METADATA.length)}` }
    }
    if (path.startsWith(CDN_IMAGES)) {
        return { bucketKey: `images/${path.slice(CDN_IMAGES.length)}` }
    }
    return null
}

const CATEGORIES = [
    'ART', 'PFP', 'GAMING', 'PHOTOGRAPHY', 'MUSIC', 'UTILITY', 'VIRTUAL_WORLDS', 'OTHER',
] as const
export type Category = (typeof CATEGORIES)[number]

export type ResolvedMetadata = {
    /** The token's name from its metadata. EVM contracts store no per-token name. */
    name: string | null
    imageUrl: string | null
    animationUrl: string | null
    description: string | null
    category: Category
    attributes: unknown
    /** True only when an image URL was found and actually served an image. */
    imageOk: boolean
    /** Why resolution fell short, for the admin triage view. */
    reason: string | null
}

const EMPTY: ResolvedMetadata = {
    name: null,
    imageUrl: null,
    animationUrl: null,
    description: null,
    category: 'OTHER',
    attributes: null,
    imageOk: false,
    reason: 'not resolved',
}

const normalizeCategory = (v: unknown): Category | null => {
    if (typeof v !== 'string') return null
    const s = v.trim().toUpperCase().replace(/[\s-]+/g, '_')
    return (CATEGORIES as readonly string[]).includes(s) ? (s as Category) : null
}

/** Pull a category out of the attributes array, accepting the usual trait_type spellings. */
const categoryFromAttributes = (attributes: unknown): Category | null => {
    if (!Array.isArray(attributes)) return null
    for (const attr of attributes) {
        const key = String(attr?.trait_type ?? attr?.traitType ?? '').trim().toLowerCase()
        if (key === 'category') {
            const c = normalizeCategory(attr?.value)
            if (c) return c
        }
    }
    return null
}

const fetchWithTimeout = async (url: string, init?: RequestInit): Promise<Response> =>
    fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })

/**
 * Confirm a URL actually serves an image.
 *
 * This is what makes imageOk mean something. HEAD first since it is cheap; some hosts reject
 * HEAD, so fall back to a ranged GET rather than pulling a whole file down to check.
 */
const imageResolves = async (env: CloudflareBindings, url: string): Promise<boolean> => {
    // Self-hosted image: ask the bucket. A HEAD to our own hostname would never arrive.
    const own = r2KeyFor(url)
    if (own) {
        try {
            const head = await env.NFT_IMAGES.head(own.bucketKey)
            return head !== null
        } catch (e) {
            console.error('r2 head failed:', e)
            return false
        }
    }

    const looksLikeImage = (res: Response) => {
        const type = res.headers.get('content-type') ?? ''
        // An empty content-type is tolerated: R2 can omit it, and a 200 is still evidence.
        return res.ok && (type === '' || type.startsWith('image/') || type.startsWith('video/'))
    }
    try {
        const head = await fetchWithTimeout(url, { method: 'HEAD' })
        if (head.status !== 405 && head.status !== 501) return looksLikeImage(head)
    } catch {
        // fall through to the ranged GET
    }
    try {
        const res = await fetchWithTimeout(url, { headers: { Range: 'bytes=0-0' } })
        return looksLikeImage(res)
    } catch {
        return false
    }
}

/**
 * Fetch and interpret a token's metadata JSON.
 *
 * Never throws: a mint has already happened on chain by the time this runs, and an unreachable
 * metadata host must not roll it back. Failure returns imageOk false with a reason, so the asset
 * is recorded, hidden from the grid, and re-resolvable later.
 */
export const resolveMetadata = async (
    env: CloudflareBindings,
    uri: string | null | undefined
): Promise<ResolvedMetadata> => {
    if (!uri) return { ...EMPTY, reason: 'no metadata uri' }
    if (!/^https?:\/\//i.test(uri)) return { ...EMPTY, reason: `unsupported uri scheme: ${uri.slice(0, 40)}` }

    let json: any
    const own = r2KeyFor(uri)
    if (own) {
        // Read straight from the bucket: a self-subrequest would 404 regardless of the object.
        try {
            const object = await env.NFT_IMAGES.get(own.bucketKey)
            if (!object) return { ...EMPTY, reason: `no R2 object at ${own.bucketKey}` }
            json = await object.json()
        } catch (e: any) {
            return { ...EMPTY, reason: `R2 read failed: ${e?.message ?? 'error'}` }
        }
    } else {
        try {
            const res = await fetchWithTimeout(uri)
            if (!res.ok) return { ...EMPTY, reason: `metadata fetch returned ${res.status}` }
            json = await res.json()
        } catch (e: any) {
            return { ...EMPTY, reason: `metadata unreachable: ${e?.name === 'TimeoutError' ? 'timed out' : e?.message ?? 'error'}` }
        }
    }

    if (!json || typeof json !== 'object') return { ...EMPTY, reason: 'metadata is not a JSON object' }

    // image / image_url / properties.files[0].uri cover the shapes in the wild.
    const rawImage =
        json.image ??
        json.image_url ??
        json.imageUrl ??
        (Array.isArray(json.properties?.files) ? json.properties.files[0]?.uri : undefined)

    const imageUrl = typeof rawImage === 'string' && rawImage.trim() ? rawImage.trim() : null
    const animationUrl =
        typeof json.animation_url === 'string' && json.animation_url.trim()
            ? json.animation_url.trim()
            : null

    const description =
        typeof json.description === 'string' && json.description.trim()
            ? json.description.trim()
            : null

    const category =
        categoryFromAttributes(json.attributes) ?? normalizeCategory(json.category) ?? 'OTHER'

    const name =
        typeof json.name === 'string' && json.name.trim() ? json.name.trim() : null

    if (!imageUrl) {
        return {
            name,
            imageUrl: null,
            animationUrl,
            description,
            category,
            attributes: json.attributes ?? null,
            imageOk: false,
            reason: 'metadata has no image field',
        }
    }

    const ok = await imageResolves(env, imageUrl)
    return {
        name,
        imageUrl,
        animationUrl,
        description,
        category,
        attributes: json.attributes ?? null,
        imageOk: ok,
        reason: ok ? null : 'image url did not serve an image',
    }
}
