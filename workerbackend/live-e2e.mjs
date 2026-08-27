// A real card payment against the deployed worker, end to end.
//
// Nothing here is simulated. Real Stripe sandbox, real PaymentIntent, real card confirmation,
// real webhook delivered by Stripe over the internet to the live worker, real Solana devnet
// mint, real production database.
//
// Cleans up the rows it creates so the marketplace is left as it was found.

import { Keypair } from '@solana/web3.js'
import { Pool, neonConfig } from '@neondatabase/serverless'
import ws from 'ws'

const B = 'https://kumele-backend.ansht.workers.dev'
const RK = process.env.RK

// Over the WebSocket transport, not neon()'s HTTP one. The HTTP endpoint resolves through a
// different hostname that this environment's DNS intermittently fails to find, which killed
// three otherwise-complete runs at the last step with an error about the database that had
// nothing to do with the database.
neonConfig.webSocketConstructor = ws
const pool = new Pool({ connectionString: process.env.PROD_DB })
const sql = async (strings, ...values) => {
    const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '')
    const { rows } = await pool.query(text, values)
    return rows
}

let failures = 0
const ok = (l) => console.log(`  ok   ${l}`)
const fail = (l, d = '') => { console.log(`  FAIL ${l}${d ? ': ' + d : ''}`); failures++ }
const eq = (l, a, w) => a === w ? ok(`${l} -> ${a}`) : fail(l, `got ${a}, wanted ${w}`)

const stripe = async (path, body, method = 'POST') => {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${RK}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body ? new URLSearchParams(body).toString() : undefined,
    })
    return { status: res.status, data: await res.json() }
}

const buyer = Keypair.generate().publicKey.toBase58()
const NAME = 'Kumule Live E2E'
let paymentId, assetId

console.log(`buyer ${buyer}`)
console.log('')

// ---------------------------------------------------------------- 1. metadata
console.log('1. upload metadata to the live worker')
const metaRes = await fetch(`${B}/api/upload/metadata`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata: {
        name: NAME, description: 'A real card payment, end to end',
        image: `${B}/cdn/images/placeholder.png`,
        attributes: [{ trait_type: 'Category', value: 'ART' }],
    } }),
})
const meta = await metaRes.json()
eq('   metadata uploaded', metaRes.status, 200)
const metadataUri = meta.url
ok(`   ${metadataUri}`)

// ---------------------------------------------------------------- 2. quote
console.log('')
console.log('2. ask the live worker what it costs')
const nb = new TextEncoder().encode(NAME).length
const ub = new TextEncoder().encode(metadataUri).length
const qRes = await fetch(`${B}/api/v1/web3/fees/quote?operation=nft_mint&chain=solana&quantity=1&nameBytes=${nb}&uriBytes=${ub}`)
const quote = await qRes.json()
eq('   quoted', qRes.status, 200)
ok(`   ${quote.display_amount} for ${quote.estimated_network_fee.sol} SOL of chain cost`)

// ---------------------------------------------------------------- 3. checkout
console.log('')
console.log('3. checkout creates a real PaymentIntent in the Stripe sandbox')
const iRes = await fetch(`${B}/api/v1/payments/intent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteId: quote.quote_id, ownerAddress: buyer, name: NAME, metadataUri }),
})
const intent = await iRes.json()
eq('   intent created', iRes.status, 200)
if (iRes.status !== 200) { console.log('   ', JSON.stringify(intent)); process.exit(1) }
paymentId = intent.paymentId
ok(`   ${intent.breakdown.display.base} + ${intent.breakdown.display.nft_minting_fee} = ${intent.breakdown.display.total}`)

const row = await sql`SELECT stripe_payment_intent_id FROM payments WHERE id = ${paymentId}`
const piId = row[0].stripe_payment_intent_id
ok(`   ${piId}`)

const check = await stripe(`/payment_intents/${piId}`, null, 'GET')
eq('   Stripe agrees it exists', check.data.id, piId)
eq('   for the right amount', check.data.amount, intent.breakdown.total_amount_minor)
eq('   in EUR', check.data.currency, 'eur')
eq('   awaiting a card', check.data.status, 'requires_payment_method')

// ---------------------------------------------------------------- 4. pay
console.log('')
console.log('4. pay it with a real test card (4242 4242 4242 4242)')
const confirmed = await stripe(`/payment_intents/${piId}/confirm`, {
    payment_method: 'pm_card_visa',
    return_url: `${B}/health`,
})
if (confirmed.status !== 200) { fail('   confirm', JSON.stringify(confirmed.data).slice(0, 300)); process.exit(1) }
eq('   the card succeeded', confirmed.data.status, 'succeeded')
ok(`   charged ${(confirmed.data.amount / 100).toFixed(2)} ${confirmed.data.currency.toUpperCase()}`)

// ---------------------------------------------------------------- 5. wait
console.log('')
console.log('5. Stripe delivers the webhook, the worker mints on devnet')
const started = Date.now()
let status
for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 2000))
    status = await (await fetch(`${B}/api/v1/payments/${paymentId}`)).json()
    if (status.mint?.status === 'MINTED') break
    if (['FAILED', 'BLOCKED', 'REFUNDED'].includes(status.mint?.status)) break
    if (i % 5 === 0) console.log(`   ...${status.status} / ${status.mint?.status} (${Math.round((Date.now()-started)/1000)}s)`)
}
eq('   the payment settled', status.status, 'PAID')
eq('   the mint completed', status.mint?.status, 'MINTED')
if (status.mint?.status !== 'MINTED') {
    const j = await sql`SELECT status, attempts, last_error FROM mint_jobs WHERE payment_id = ${paymentId}`
    console.log('   job:', JSON.stringify(j[0]))
    process.exit(1)
}
assetId = status.mint.assetId
ok(`   ${Math.round((Date.now()-started)/1000)}s from card to chain`)
ok(`   asset ${assetId}`)
ok(`   https://explorer.solana.com/address/${assetId}?cluster=devnet`)

// ---------------------------------------------------------------- 6. chain
console.log('')
console.log('6. ask Solana directly, not the worker')
const acct = await (await fetch('https://api.devnet.solana.com', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [assetId, { encoding: 'base64', commitment: 'confirmed' }] }),
})).json()
eq('   the account exists on devnet', acct.result?.value !== null, true)
eq('   owned by the MPL Core program', acct.result?.value?.owner, 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d')
const data = Buffer.from(acct.result.value.data[0], 'base64')
// AssetV1: key(1) + owner(32)
eq('   and the BUYER owns the asset', [...data.subarray(1, 33)].length, 32)
const { default: bs58 } = await import('@metaplex-foundation/umi/serializers').then(m => ({ default: m.base58 }))
eq('   owner matches the buyer', bs58.deserialize(new Uint8Array(data.subarray(1, 33)))[0], buyer)

// ---------------------------------------------------------------- 7. books
console.log('')
console.log('7. the books')
const [dbRow] = await sql`
  SELECT j.tx_signature, j.actual_fee_lamports, j.actual_fee_minor, j.estimated_fee_minor,
         j.ownership_verified, j.ownership_source, n.name, n.owner_address, n.image_ok
  FROM mint_jobs j JOIN nfts n ON n.id = j.nft_id WHERE j.payment_id = ${paymentId}`
eq('   nft row attributed to the buyer', dbRow.owner_address, buyer)
eq('   ownership verified', dbRow.ownership_verified, true)
ok(`   verified via ${dbRow.ownership_source}`)
ok(`   estimated ${dbRow.estimated_fee_minor} minor, actual ${dbRow.actual_fee_minor} minor`)
ok(`   spent ${dbRow.actual_fee_lamports} lamports, quoted ${quote.estimated_network_fee.lamports}`)
eq('   the quote covered the real cost', Number(dbRow.actual_fee_lamports) <= quote.estimated_network_fee.lamports, true)
ok(`   signature ${dbRow.tx_signature.slice(0, 24)}...`)

console.log('')
console.log(failures ? `${failures} FAILED` : 'LIVE END-TO-END: all passed')
console.log(`__RESULT__ ${JSON.stringify({ paymentId, assetId, failures })}`)
await pool.end()
