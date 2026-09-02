// Asserts for src/kumeleMint.ts. Run: npx tsx kumele-mint-check.ts
//
// No DB, no network for this half of the file: verifyMintApiSignature, validateMintRequest
// and mintApiResponseFor are pure, the same way verifyWebhookSignature and quoteMintFee
// are pure - so the auth and validation logic for a real-money endpoint is checked without
// standing up Postgres or a stub RPC.

import {
    verifyMintApiSignature,
    validateMintRequest,
    mintApiResponseFor,
    buildCallbackPayload,
    signCallback,
} from './src/kumeleMint'

let failures = 0
const ok = (label: string) => console.log(`  ok   ${label}`)
const fail = (label: string, detail = '') => {
    console.log(`  FAIL ${label}${detail ? ': ' + detail : ''}`)
    failures++
}
const eq = (label: string, got: unknown, want: unknown) => {
    const g = JSON.stringify(got), w = JSON.stringify(want)
    g === w ? ok(label) : fail(label, `got ${g} want ${w}`)
}

const SECRET = 'test-shared-secret'
const RECIPIENT = 'F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F'

async function run() {
    // --- verifyMintApiSignature -----------------------------------------------------
    const body = '{"payment_intent_id":"pi_1"}'
    const ts = Math.floor(Date.now() / 1000)
    const hmacKey = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    const mac = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(`${ts}.${body}`))
    const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('')

    const valid = await verifyMintApiSignature(body, `sha256=${hex}`, String(ts), SECRET)
    eq('valid signature accepted', valid.ok, true)

    const tampered = await verifyMintApiSignature(body + 'x', `sha256=${hex}`, String(ts), SECRET)
    eq('tampered body rejected', tampered.ok, false)

    const wrongSecret = await verifyMintApiSignature(body, `sha256=${hex}`, String(ts), 'not-the-secret')
    eq('wrong secret rejected', wrongSecret.ok, false)

    const stale = await verifyMintApiSignature(body, `sha256=${hex}`, String(ts - 400), SECRET)
    eq('stale timestamp rejected', stale.ok, false)

    const missing = await verifyMintApiSignature(body, undefined, String(ts), SECRET)
    eq('missing signature header rejected', missing.ok, false)

    const malformed = await verifyMintApiSignature(body, 'not-sha256-prefixed', String(ts), SECRET)
    eq('malformed signature header rejected', malformed.ok, false)

    // --- validateMintRequest ---------------------------------------------------------
    const goodInput = {
        payment_intent_id: 'pi_1',
        order_id: 'ord_1',
        chain: 'solana',
        recipient_wallet: RECIPIENT,
        quantity: 1,
        name: 'Test Asset',
        metadata_uri: 'https://example.com/m.json',
    }
    const goodResult = validateMintRequest(goodInput)
    eq('valid input accepted', goodResult.ok, true)

    eq(
        'quantity != 1 rejected',
        validateMintRequest({ ...goodInput, quantity: 2 }).ok,
        false
    )
    eq(
        'unsupported chain rejected',
        validateMintRequest({ ...goodInput, chain: 'ethereum' }).ok,
        false
    )
    eq(
        'invalid wallet rejected',
        validateMintRequest({ ...goodInput, recipient_wallet: 'not-a-wallet' }).ok,
        false
    )
    eq(
        'missing payment_intent_id rejected',
        validateMintRequest({ ...goodInput, payment_intent_id: '' }).ok,
        false
    )
    eq(
        'name over byte limit rejected',
        validateMintRequest({ ...goodInput, name: 'x'.repeat(200) }).ok,
        false
    )

    // --- mintApiResponseFor -----------------------------------------------------------
    eq(
        'PENDING maps to 202 mint_pending',
        mintApiResponseFor({ status: 'PENDING' } as any),
        { httpStatus: 202, body: { status: 'mint_pending' } }
    )
    eq(
        'MINTING maps to 202 mint_pending',
        mintApiResponseFor({ status: 'MINTING' } as any),
        { httpStatus: 202, body: { status: 'mint_pending' } }
    )
    eq(
        'MINTED maps to 200 minted with address+signature',
        mintApiResponseFor({
            status: 'MINTED', mintAddress: 'ADDR', txSignature: 'SIG',
        } as any),
        { httpStatus: 200, body: { status: 'minted', mint_address: 'ADDR', tx_signature: 'SIG' } }
    )
    eq(
        'BLOCKED maps to 200 mint_failed with reason',
        mintApiResponseFor({ status: 'BLOCKED', lastError: 'squatted address' } as any),
        { httpStatus: 200, body: { status: 'mint_failed', reason: 'squatted address' } }
    )

    // --- buildCallbackPayload / signCallback -----------------------------------------
    const mintedPayment = {
        stripePaymentIntentId: 'pi_1', orderId: 'ord_1',
    }
    const mintedJob = {
        status: 'MINTED', mintAddress: 'ADDR', txSignature: 'SIG',
        ownerAddress: RECIPIENT, updatedAt: new Date('2026-09-02T12:00:00Z'), lastError: null,
    }
    const mintedPayload = buildCallbackPayload(mintedPayment as any, mintedJob as any)
    eq('minted callback payload shape', mintedPayload, {
        payment_intent_id: 'pi_1',
        order_id: 'ord_1',
        status: 'minted',
        mint_address: 'ADDR',
        tx_signature: 'SIG',
        recipient_wallet: RECIPIENT,
        chain: 'solana',
        occurred_at: '2026-09-02T12:00:00.000Z',
        failure_reason: null,
    })

    const failedJob = {
        status: 'BLOCKED', mintAddress: null, txSignature: null,
        ownerAddress: RECIPIENT, updatedAt: new Date('2026-09-02T12:00:00Z'), lastError: 'squatted address',
    }
    const failedPayload = buildCallbackPayload(mintedPayment as any, failedJob as any)
    eq('mint_failed callback payload shape', failedPayload, {
        payment_intent_id: 'pi_1',
        order_id: 'ord_1',
        status: 'mint_failed',
        mint_address: null,
        tx_signature: null,
        recipient_wallet: RECIPIENT,
        chain: 'solana',
        occurred_at: '2026-09-02T12:00:00.000Z',
        failure_reason: 'squatted address',
    })

    const rawPayload = JSON.stringify(mintedPayload)
    const { header, timestamp } = await signCallback(rawPayload, SECRET)
    const verified = await verifyMintApiSignature(rawPayload, header, String(timestamp), SECRET)
    eq('a callback this worker signs verifies against the same secret', verified.ok, true)

    console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`)
    process.exit(failures === 0 ? 0 : 1)
}

run()
