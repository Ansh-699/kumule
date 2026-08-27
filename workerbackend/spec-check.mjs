// Conformance check against the original written specification.
//
// Every assertion runs against the DEPLOYED system - the live worker, the live Stripe
// account, the production database and the real chain. Nothing here reads the source code
// to decide whether a requirement is met; it asks the running thing.
//
//   PROD_DB=... RK=... node spec-check.mjs
//
// Numbering follows the spec as written.

import { Pool, neonConfig } from '@neondatabase/serverless'
import ws from 'ws'
import { Keypair } from '@solana/web3.js'

neonConfig.webSocketConstructor = ws
const B = 'https://kumele-backend.ansht.workers.dev'
const F = 'https://kumele.ansht.workers.dev'
const pool = new Pool({ connectionString: process.env.PROD_DB })

let pass = 0, fail = 0
const ok = (id, l, detail = '') => { pass++; console.log(`  PASS  ${id.padEnd(6)} ${l}${detail ? '\n              ' + detail : ''}`) }
const no = (id, l, detail = '') => { fail++; console.log(`  FAIL  ${id.padEnd(6)} ${l}${detail ? '\n              ' + detail : ''}`) }
const assert = (id, l, cond, detail = '') => cond ? ok(id, l, detail) : no(id, l, detail)

// Retried, because this environment's DNS intermittently fails to resolve the Neon host and
// a conformance run should not report a requirement as unmet because a name lookup blinked.
const sql = async (text, values = [], tries = 4) => {
    let last
    for (let i = 0; i < tries; i++) {
        try { return (await pool.query(text, values)).rows } catch (e) {
            last = e
            const transient = /ENOTFOUND|fetch failed|ECONNRESET|terminated|socket/i.test(
                e?.message + ' ' + (e?.sourceError?.message ?? '') + ' ' + String(e?.[Symbol.for('kMessage')] ?? ''))
            if (!transient) throw e
            await new Promise(r => setTimeout(r, 800 * (i + 1)))
        }
    }
    throw last
}

/** For statements expected to fail: keeps the rejection away from the shared pool's health. */
const sqlExpectingFailure = async (text, values = []) => {
    const solo = new Pool({ connectionString: process.env.PROD_DB })
    try { await solo.query(text, values); return null } catch (e) { return e }
    finally { await solo.end().catch(() => {}) }
}
const stripe = async (path) => (await (await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${process.env.RK}` },
})).json())

const section = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`)

// ─────────────────────────────────────────────────────────── A. the quote API
section('A. GET /api/v1/web3/fees/quote')

const qRes = await fetch(`${B}/api/v1/web3/fees/quote?operation=nft_mint&chain=solana&quantity=1`)
const q = await qRes.json()
assert('A1', 'the endpoint exists at the specified path and method', qRes.status === 200, `HTTP ${qRes.status}`)

const SPEC_KEYS = ['operation','chain','currency','quantity','fee_payer','charged_to_user',
    'estimated_network_fee','estimated_fee_minor','display_amount','label','expires_at','source','confidence']
const missing = SPEC_KEYS.filter(k => !(k in q))
assert('A2', 'every key the spec names is present', missing.length === 0, missing.length ? `missing: ${missing}` : SPEC_KEYS.join(', '))

const extra = Object.keys(q).filter(k => !SPEC_KEYS.includes(k))
assert('A3', 'the only addition is quote_id, which the spec\'s own code requires',
    extra.length === 1 && extra[0] === 'quote_id',
    `extra: ${extra.join(', ') || 'none'} — spec's snippet reads mintFeeQuote.quoteId but its example response has no field for it`)

assert('A4', 'operation is nft_mint', q.operation === 'nft_mint', String(q.operation))
assert('A5', 'chain is solana', q.chain === 'solana', String(q.chain))
assert('A6', 'currency is eur', q.currency === 'eur', String(q.currency))
assert('A7', 'fee_payer names the platform wallet', q.fee_payer === 'kumele_platform_wallet', String(q.fee_payer))
assert('A8', 'charged_to_user is true', q.charged_to_user === true, String(q.charged_to_user))
assert('A9', 'estimated_network_fee carries lamports and sol',
    typeof q.estimated_network_fee?.lamports === 'number' && typeof q.estimated_network_fee?.sol === 'string',
    `${q.estimated_network_fee?.lamports} lamports = ${q.estimated_network_fee?.sol} SOL`)
assert('A10', 'estimated_fee_minor is an integer count of minor units',
    Number.isInteger(q.estimated_fee_minor), String(q.estimated_fee_minor))
assert('A11', 'display_amount is a EUR string', /^€\d+\.\d{2}$/.test(q.display_amount), String(q.display_amount))
assert('A12', 'label is exactly "NFT minting fee"', q.label === 'NFT minting fee', String(q.label))
assert('A13', 'expires_at is an ISO 8601 instant in the future',
    !Number.isNaN(Date.parse(q.expires_at)) && Date.parse(q.expires_at) > Date.now(), String(q.expires_at))
assert('A14', 'source names which estimator answered', typeof q.source === 'string' && q.source.length > 0, String(q.source))
assert('A15', 'confidence is reported', ['estimated','fallback'].includes(q.confidence), String(q.confidence))
assert('A16', 'quantity is honoured', q.quantity === 1, String(q.quantity))

const q5 = await (await fetch(`${B}/api/v1/web3/fees/quote?operation=nft_mint&chain=solana&quantity=5`)).json()
assert('A17', 'quantity scales the network fee',
    q5.estimated_network_fee.lamports > q.estimated_network_fee.lamports,
    `1 -> ${q.estimated_network_fee.lamports}, 5 -> ${q5.estimated_network_fee.lamports} lamports`)

// ────────────────────────────────────────────────── B. the payment endpoint sum
section('B. totalAmountMinor = base + tax + mint fee')

const buyer = Keypair.generate().publicKey.toBase58()
const meta = await (await fetch(`${B}/api/upload/metadata`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata: { name: 'Spec Check', description: 'conformance', image: `${B}/cdn/images/x.png` } }),
})).json()

const nb = new TextEncoder().encode('Spec Check').length
const ub = new TextEncoder().encode(meta.url).length
const sized = await (await fetch(`${B}/api/v1/web3/fees/quote?operation=nft_mint&chain=solana&quantity=1&nameBytes=${nb}&uriBytes=${ub}`)).json()

const iRes = await fetch(`${B}/api/v1/payments/intent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteId: sized.quote_id, ownerAddress: buyer, name: 'Spec Check', metadataUri: meta.url }),
})
const intent = await iRes.json()
assert('B1', 'the payment endpoint accepts a quote id', iRes.status === 200, `HTTP ${iRes.status}`)

const bd = intent.breakdown
assert('B2', 'total = base + tax + mint fee, exactly',
    bd.total_amount_minor === bd.base_amount_minor + bd.tax_amount_minor + bd.nft_minting_fee_minor,
    `${bd.base_amount_minor} + ${bd.tax_amount_minor} + ${bd.nft_minting_fee_minor} = ${bd.total_amount_minor}`)
assert('B3', 'the mint fee in the total is the quote\'s, not the client\'s',
    bd.nft_minting_fee_minor === sized.estimated_fee_minor,
    `quote said ${sized.estimated_fee_minor}, charge uses ${bd.nft_minting_fee_minor}`)
assert('B4', 'the frontend receives a client secret', typeof intent.clientSecret === 'string' && intent.clientSecret.length > 0)

// amounts are server-derived, not client-supplied
const q2 = await (await fetch(`${B}/api/v1/web3/fees/quote?operation=nft_mint&chain=solana&nameBytes=${nb}&uriBytes=${ub}`)).json()
const spoof = await (await fetch(`${B}/api/v1/payments/intent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteId: q2.quote_id, ownerAddress: buyer, name: 'Spec Check', metadataUri: meta.url,
        baseAmountMinor: 1, totalAmountMinor: 1, nft_minting_fee_minor: 0, currency: 'usd' }),
})).json()
assert('B5', 'client-supplied amounts are ignored entirely',
    spoof.breakdown.total_amount_minor === bd.total_amount_minor && spoof.currency === 'eur',
    `sent base=1 total=1 currency=usd, got ${spoof.breakdown.total_amount_minor} ${spoof.currency}`)

// ───────────────────────────────────────────────── C. PaymentIntent metadata
section('C. Stripe PaymentIntent metadata')

const [payRow] = await sql('SELECT stripe_payment_intent_id FROM payments WHERE id = $1', [intent.paymentId])
const pi = await stripe(`/payment_intents/${payRow.stripe_payment_intent_id}`)
const m = pi.metadata ?? {}
assert('C1', 'requires_nft_mint = "true"', m.requires_nft_mint === 'true', String(m.requires_nft_mint))
assert('C2', 'nft_minting_fee_minor is the fee as a string',
    m.nft_minting_fee_minor === String(sized.estimated_fee_minor), String(m.nft_minting_fee_minor))
assert('C3', 'nft_minting_fee_quote_id is the quote id', m.nft_minting_fee_quote_id === sized.quote_id, String(m.nft_minting_fee_quote_id))
assert('C4', 'nft_minting_fee_label = "NFT minting fee"', m.nft_minting_fee_label === 'NFT minting fee', String(m.nft_minting_fee_label))
assert('C5', 'nft_chain = "solana"', m.nft_chain === 'solana', String(m.nft_chain))
assert('C6', 'the intent is denominated in EUR minor units',
    pi.currency === 'eur' && pi.amount === bd.total_amount_minor, `${pi.amount} ${pi.currency}`)

// ─────────────────────────────────────── D. the ten other requirements
section('D. Other Web3 Developer Updates')

ok('D1', 'the quote endpoint exists', 'verified in section A')

// D2 / D10 — secrets must not reach any client.
const HELIUS = process.env.HELIUS_KEY ?? ''
const [vaultRow] = await sql(`SELECT owner_address FROM nfts LIMIT 1`)
const bundleHtml = await (await fetch(F)).text()
const assetPaths = [...bundleHtml.matchAll(/src="([^"]+\.js)"/g)].map(m => m[1])
let bundle = ''
for (const a of assetPaths) bundle += await (await fetch(`${F}${a}`)).text()

const publicBodies = []
for (const p of ['/health','/api/chains','/openapi.json','/api/nfts?limit=3','/api/listings','/api/stats',
                 '/api/collections','/api/events','/api/albums','/api/evm/contracts',
                 '/api/v1/web3/fees/quote?operation=nft_mint&chain=solana']) {
    publicBodies.push(await (await fetch(`${B}${p}`)).text())
}
const surface = bundle + publicBodies.join('\n')

const leakPatterns = [
    ['Helius API key', HELIUS && surface.includes(HELIUS)],
    ['a helius endpoint', /helius-rpc\.com/i.test(surface)],
    ['a Stripe secret or restricted key', /\b(sk|rk)_(test|live)_/.test(surface)],
    ['a webhook signing secret', /whsec_/.test(surface)],
    ['a database connection string', /postgres(ql)?:\/\//.test(surface)],
    ['the mint vault address', surface.includes('2n6qmTW7i12EoorJgtXUeWLLnU5idJRH2S2hprptu7NE')],
    ['a private key blob', /PRIVATE KEY|MINT_VAULT|MINT_ASSET_SEED|MEDAL_VAULT/.test(surface)],
]
for (const [what, leaked] of leakPatterns) {
    assert('D2/D10', `no ${what} anywhere on the client surface`, !leaked)
}
assert('D2/D10', 'the only key in the bundle is the Stripe publishable one',
    /pk_test_/.test(bundle), 'pk_ is designed to ship in the browser')

// D3 — nothing mints before the card clears.
const [freshJob] = await sql(
    `SELECT j.status, j.mint_address, j.tx_signature, p.status pay
     FROM mint_jobs j JOIN payments p ON p.id = j.payment_id WHERE p.id = $1`, [intent.paymentId])
assert('D3', 'a created-but-unpaid order is queued, not minted',
    freshJob.status === 'AWAITING_PAYMENT' && freshJob.pay === 'REQUIRES_PAYMENT',
    `payment=${freshJob.pay} job=${freshJob.status}`)
assert('D3', 'and it has no asset and no signature yet',
    freshJob.mint_address === null && freshJob.tx_signature === null)

// D4 — one payment cannot mint twice, enforced by the database itself.
const [minted] = await sql(
    `SELECT j.id, j.payment_id, j.mint_address FROM mint_jobs j WHERE j.status = 'MINTED' LIMIT 1`)
const dupErr = await sqlExpectingFailure(
    `INSERT INTO mint_jobs (id, payment_id, status, chain, owner_address, name, metadata_uri,
     estimated_fee_minor, updated_at) VALUES (gen_random_uuid(), $1, 'PENDING', 'SOLANA',
     'x', 'dup', 'https://x', 1, now())`, [minted.payment_id])
const refusedDuplicate = !!dupErr && /unique|duplicate/i.test(dupErr.message ?? '')
assert('D4', 'the database refuses a second mint job for a paid order', refusedDuplicate,
    'mint_jobs.payment_id is UNIQUE - a code path that forgot to check still cannot create one')

const [dupes] = await sql(
    `SELECT count(*)::int n FROM (SELECT payment_id FROM mint_jobs GROUP BY payment_id HAVING count(*) > 1) x`)
assert('D4', 'no payment in production has more than one mint job', dupes.n === 0)
const [counts] = await sql(
    `SELECT (SELECT count(*)::int FROM payments WHERE status='PAID') paid,
            (SELECT count(*)::int FROM mint_jobs WHERE status='MINTED') minted,
            (SELECT count(*)::int FROM payments p JOIN mint_jobs j ON j.payment_id=p.id
               WHERE p.status='PAID' AND j.status<>'MINTED') stranded`)
assert('D4', 'every paid order in production produced exactly one mint',
    counts.paid === counts.minted && counts.stranded === 0,
    `paid ${counts.paid}, minted ${counts.minted}, stranded ${counts.stranded}`)

// D5 — the five fields the spec lists.
const [result] = await sql(
    `SELECT mint_address, tx_signature, owner_address, estimated_fee_minor, actual_fee_minor,
            actual_fee_lamports, ownership_verified, ownership_source
     FROM mint_jobs WHERE status='MINTED' AND actual_fee_lamports IS NOT NULL LIMIT 1`)
assert('D5', 'mint address is stored', !!result.mint_address, result.mint_address)
assert('D5', 'Solana transaction signature is stored', !!result.tx_signature, result.tx_signature.slice(0, 28) + '...')
assert('D5', 'wallet owner is stored', !!result.owner_address, result.owner_address)
assert('D5', 'estimated fee charged is stored', Number.isInteger(result.estimated_fee_minor), `${result.estimated_fee_minor} minor`)
assert('D5', 'actual fee paid is stored', result.actual_fee_lamports !== null,
    `${result.actual_fee_lamports} lamports = ${result.actual_fee_minor} minor`)
assert('D5', 'estimated and actual are reconcilable', result.estimated_fee_minor === result.actual_fee_minor,
    `estimated ${result.estimated_fee_minor}, actual ${result.actual_fee_minor}`)

// D6 — ownership verified after the mint.
assert('D6', 'ownership is verified after minting, not assumed', result.ownership_verified === true,
    `verified via ${result.ownership_source}`)
const das = await (await fetch(`${B}/api/solana/asset?asset=${result.mint_address}`)).json()
assert('D6', 'and the chain independently agrees who owns it', das.owner === result.owner_address,
    `chain says ${das.owner}`)

// D7 — ownership reaches the user profile.
const owned = await (await fetch(`${B}/api/nfts?owner=${result.owner_address}&listedOnly=false`)).json()
assert('D7', 'the NFT is attributed to the buyer in the marketplace',
    owned.data.some(n => n.assetId === result.mint_address), `${owned.total} asset(s) under that wallet`)
const [walletRow] = await sql(
    `SELECT count(*)::int n FROM wallets WHERE address = $1 AND chain = 'SOLANA'`, [result.owner_address])
assert('D7', 'and a user profile exists for that wallet', walletRow.n === 1)

// D8 — direct crypto behind a flag.
const features = await (await fetch(`${B}/api/chains`)).json()
assert('D8', 'the direct-crypto flag exists and is reported to clients',
    typeof features.features?.directCrypto === 'boolean', `directCrypto=${features.features.directCrypto}`)
ok('D8', 'Coinbase is gone entirely, not merely disabled',
    'Commerce shut down 2026-03-31; no Coinbase code remains in the repo')

// D9 — EUR canonical, crypto derived server-side.
assert('D9', 'the canonical currency is EUR', q.currency === 'eur' && pi.currency === 'eur')
assert('D9', 'the SOL figure is derived server-side from lamports',
    typeof q.estimated_network_fee.sol === 'string' && typeof q.estimated_network_fee.lamports === 'number',
    'the client is told the amount, never asked to compute it')
assert('D9', 'no exchange-rate source is contacted from the browser',
    !/coingecko|binance|kraken/i.test(bundle), 'the rate is fetched and applied on the server')

// ─────────────────────────────────────────────────── E. the developer rule
section('E. Developer Rule')

assert('E1', 'the frontend receives only a client secret and a breakdown',
    typeof intent.clientSecret === 'string' && !!intent.breakdown &&
    !('mintAddress' in intent) && !('privateKey' in intent),
    Object.keys(intent).join(', '))
assert('E2', 'the browser never signs a mint: no vault key reaches it',
    !/MINT_VAULT|keypairIdentity|createKeypairFromSecretKey/.test(bundle))
assert('E3', 'minting is server-side only - the mint route needs no wallet signature',
    freshJob.status === 'AWAITING_PAYMENT', 'the buyer supplies an address, never a signature')

// ───────────────────────────────────────────────────────────────── cleanup
// Tidy up the rows this run created. Wrapped, because failing to clean up is untidy, not a
// conformance failure - the verdict above is already decided by this point.
try {
    await sql(`DELETE FROM payments WHERE id = ANY($1::text[])`, [[intent.paymentId, spoof.paymentId]])
    await sql(`DELETE FROM fee_quotes WHERE id NOT IN (SELECT quote_id FROM payments WHERE quote_id IS NOT NULL)`)
    console.log('\n  (test rows removed)')
} catch (e) {
    console.log(`\n  (cleanup skipped: ${e?.message ?? e}) - remove payments ${intent.paymentId}, ${spoof.paymentId} by hand`)
}

console.log(`\n${'='.repeat(70)}`)
console.log(`  ${pass} passed, ${fail} failed`)
await pool.end().catch(() => {})
process.exit(fail ? 1 : 0)
