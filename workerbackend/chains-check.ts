// Asserts for src/chains.ts. Run: bun chains-check.ts
//
// This file carries money conversion and cross-chain asset identity. A rounding slip here
// mis-prices a listing, and an assetId slip points a trade at the wrong token, so both get
// pinned rather than eyeballed.

import {
    parseChain, isChain, chainFromAddress, isValidAddress, isSolanaAddress, normalizeAddress,
    makeAssetId, parseAssetId, fromBaseUnits, toBaseUnits, CHAIN_CONFIG,
    solanaRpcChain, SOLANA_RPC_FALLBACKS, solanaRpc,
} from './src/chains'

let failures = 0
const eq = (name: string, got: unknown, want: unknown) => {
    const g = JSON.stringify(got), w = JSON.stringify(want)
    if (g === w) { console.log(`  ok   ${name}`) } else { failures++; console.error(`  FAIL ${name}: got ${g} want ${w}`) }
}
const throws = (name: string, fn: () => unknown) => {
    try { fn(); failures++; console.error(`  FAIL ${name}: expected a throw`) }
    catch { console.log(`  ok   ${name}`) }
}

const SOL_MINT = 'F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F'
const EVM_NFT = '0x416e7Fd93fc2210540AAC1c1cC17a851148DfEBD'

console.log('parseChain:')
eq('SOLANA', parseChain('SOLANA'), 'SOLANA')
eq('sol alias', parseChain('sol'), 'SOLANA')
eq('eth alias', parseChain('ETH'), 'ETHEREUM')
eq('base alias maps to ETHEREUM', parseChain('base'), 'ETHEREUM')
eq('evm alias', parseChain('evm'), 'ETHEREUM')
eq('whitespace tolerated', parseChain('  Solana '), 'SOLANA')
eq('garbage is null, not a default', parseChain('bitcoin'), null)
eq('undefined is null', parseChain(undefined), null)
eq('isChain rejects alias', isChain('sol'), false)
eq('isChain accepts canonical', isChain('SOLANA'), true)

console.log('\naddress shapes:')
eq('evm address detected', chainFromAddress(EVM_NFT), 'ETHEREUM')
eq('solana address detected', chainFromAddress(SOL_MINT), 'SOLANA')
eq('nonsense detected as neither', chainFromAddress('hello'), null)
// Base58 excludes 0, O, I and l, so this is not a valid Solana address.
eq('base58 excludes 0OIl', chainFromAddress('0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl'), null)
eq('evm valid for ETHEREUM', isValidAddress('ETHEREUM', EVM_NFT), true)
eq('evm invalid for SOLANA', isValidAddress('SOLANA', EVM_NFT), false)
eq('short hex rejected', isValidAddress('ETHEREUM', '0xabc'), false)

// The character window is not the check. '1' is a zero byte in base58, so 43 of them is
// well-formed base58 inside the allowed length and decodes to 43 bytes, not 32. Strings like
// this used to pass validation and then throw inside publicKey(), which turned a malformed
// request into a 500 - or, once confirmBurn began failing closed, a 503 telling the caller to
// retry something that can never succeed.
eq('43 zero bytes is not an address', isSolanaAddress('1'.repeat(43)), false)
eq('32 zero bytes is the system program', isSolanaAddress('1'.repeat(32)), true)
eq('31 bytes rejected', isSolanaAddress('1'.repeat(31)), false)
eq('a real 32-byte key is accepted', isSolanaAddress(SOL_MINT), true)
eq('the escrow program id is accepted', isSolanaAddress('3ozh4TQJbeyXFUuXsj7fYmHB5aCVkg24cZN5zZmigR44'), true)
// 44 base58 chars that decode to 33 bytes: right shape, wrong key.
eq('a 33-byte value is rejected', isSolanaAddress('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'), false)

console.log('\nnormalizeAddress:')
eq('evm folds to lowercase', normalizeAddress('ETHEREUM', EVM_NFT), EVM_NFT.toLowerCase())
// Folding a base58 key changes which key it is, so Solana must never be folded.
eq('solana preserved exactly', normalizeAddress('SOLANA', SOL_MINT), SOL_MINT)

console.log('\nmakeAssetId:')
eq('solana is the bare mint', makeAssetId('SOLANA', { mintAddress: SOL_MINT }), SOL_MINT)
eq('evm is contract:tokenId lowercased',
    makeAssetId('ETHEREUM', { contractAddress: EVM_NFT, tokenId: 3 }),
    `${EVM_NFT.toLowerCase()}:3`)
eq('evm accepts bigint tokenId',
    makeAssetId('ETHEREUM', { contractAddress: EVM_NFT, tokenId: 12345678901234567890n }),
    `${EVM_NFT.toLowerCase()}:12345678901234567890`)
eq('tokenId 0 is legal',
    makeAssetId('ETHEREUM', { contractAddress: EVM_NFT, tokenId: 0 }),
    `${EVM_NFT.toLowerCase()}:0`)
throws('solana without mint', () => makeAssetId('SOLANA', {}))
throws('evm without contract', () => makeAssetId('ETHEREUM', { tokenId: 1 }))
throws('evm without tokenId', () => makeAssetId('ETHEREUM', { contractAddress: EVM_NFT }))

console.log('\nparseAssetId round-trips:')
eq('solana round-trip', parseAssetId(SOL_MINT), { chain: 'SOLANA', mintAddress: SOL_MINT })
eq('evm round-trip', parseAssetId(`${EVM_NFT.toLowerCase()}:3`),
    { chain: 'ETHEREUM', contractAddress: EVM_NFT.toLowerCase(), tokenId: '3' })
eq('evm mixed case folded on parse', parseAssetId(`${EVM_NFT}:7`),
    { chain: 'ETHEREUM', contractAddress: EVM_NFT.toLowerCase(), tokenId: '7' })
// Kept as a string so a uint256 beyond Number.MAX_SAFE_INTEGER survives intact.
eq('huge tokenId stays exact', parseAssetId(`${EVM_NFT.toLowerCase()}:99999999999999999999999`),
    { chain: 'ETHEREUM', contractAddress: EVM_NFT.toLowerCase(), tokenId: '99999999999999999999999' })
eq('empty is null', parseAssetId(''), null)
eq('non-numeric tokenId is null', parseAssetId(`${EVM_NFT.toLowerCase()}:abc`), null)
eq('bad contract is null', parseAssetId('0xzz:1'), null)
eq('bare garbage is null', parseAssetId('not-an-asset'), null)

console.log('\nfromBaseUnits:')
eq('1 SOL', fromBaseUnits(1_000_000_000n, 'SOLANA'), '1')
eq('0.5 SOL', fromBaseUnits(500_000_000n, 'SOLANA'), '0.5')
eq('1 lamport', fromBaseUnits(1n, 'SOLANA'), '0.000000001')
eq('zero', fromBaseUnits(0n, 'SOLANA'), '0')
eq('1 ETH', fromBaseUnits(10n ** 18n, 'ETHEREUM'), '1')
eq('0.001 ETH', fromBaseUnits(1_000_000_000_000_000n, 'ETHEREUM'), '0.001')
eq('1 wei stays exact', fromBaseUnits(1n, 'ETHEREUM'), '0.000000000000000001')
// The marketplace fee on a 0.001 ETH sale, the exact number the live test asserted.
eq('2.5% of 0.001 ETH', fromBaseUnits(25_000_000_000_000n, 'ETHEREUM'), '0.000025')
eq('accepts a string', fromBaseUnits('1000000000', 'SOLANA'), '1')

console.log('\ntoBaseUnits:')
eq('1 SOL', toBaseUnits('1', 'SOLANA').toString(), '1000000000')
eq('0.5 SOL', toBaseUnits('0.5', 'SOLANA').toString(), '500000000')
eq('1 ETH', toBaseUnits('1', 'ETHEREUM').toString(), (10n ** 18n).toString())
eq('0.001 ETH', toBaseUnits('0.001', 'ETHEREUM').toString(), '1000000000000000')
eq('trailing zeros harmless', toBaseUnits('1.500', 'ETHEREUM').toString(), '1500000000000000000')
// Silently rounding a price would lose the seller money; reject instead.
throws('too many decimals for SOL', () => toBaseUnits('0.0000000001', 'SOLANA'))
throws('not a number', () => toBaseUnits('abc', 'ETHEREUM'))
throws('empty string', () => toBaseUnits('', 'ETHEREUM'))

console.log('\nround-trip stability:')
for (const [chain, values] of [
    ['SOLANA', ['0', '1', '0.5', '12.345678901', '999999.999999999']],
    ['ETHEREUM', ['0', '1', '0.001', '0.000025', '1234.567890123456789']],
] as const) {
    for (const v of values) {
        // Compared against the literal string, never String(Number(v)): routing the
        // expectation through a float is exactly the precision loss this code exists to
        // avoid, and it degrades 1234.567890123456789 to 1234.567890123457.
        eq(`${chain} ${v}`, fromBaseUnits(toBaseUnits(v, chain), chain), v)
    }
}

console.log('\nrpc chain:')
// A single endpoint is a single point of failure, and both obvious choices failed in one
// afternoon: the configured provider ran out of credits (429) and Solana's own public
// endpoint refused Cloudflare egress (403), leaving a paid mint unfulfilled.
eq('the configured endpoint is tried first',
    solanaRpcChain({ SOLANA_RPC_URL: 'https://mine.example' } as any)[0], 'https://mine.example')
eq('with fallbacks behind it',
    solanaRpcChain({ SOLANA_RPC_URL: 'https://mine.example' } as any).length, SOLANA_RPC_FALLBACKS.length + 1)
eq('an unset endpoint still yields a usable chain',
    solanaRpcChain({} as any).length, SOLANA_RPC_FALLBACKS.length)
// Trying the same dead endpoint twice is not a fallback.
eq('no duplicates when the configured one is also a fallback',
    solanaRpcChain({ SOLANA_RPC_URL: SOLANA_RPC_FALLBACKS[0] } as any).length, SOLANA_RPC_FALLBACKS.length)
eq('every entry is an https url',
    solanaRpcChain({} as any).every((u) => u.startsWith('https://')), true)

// A devnet-only deployment must never be pointed at real money, and the only thing separating
// the two networks is a hostname - a provider key is usually valid on both. This was a real
// paste, not a hypothetical.
eq('a mainnet endpoint is dropped from the chain',
    solanaRpcChain({ SOLANA_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=x' } as any)
        .some((u) => /mainnet/i.test(u)), false)
eq('and the deployment still has somewhere to talk to',
    solanaRpcChain({ SOLANA_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=x' } as any).length,
    SOLANA_RPC_FALLBACKS.length)
eq('solanaRpc never returns a mainnet url either',
    /mainnet/i.test(solanaRpc({ SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com' } as any)), false)
// The devnet host of the same provider is fine.
eq('a devnet provider url is kept',
    solanaRpcChain({ SOLANA_RPC_URL: 'https://devnet.helius-rpc.com/?api-key=x' } as any)[0],
    'https://devnet.helius-rpc.com/?api-key=x')

console.log('\nconfig:')
eq('SOL currency', CHAIN_CONFIG.SOLANA.currency, 'SOL')
eq('ETH currency', CHAIN_CONFIG.ETHEREUM.currency, 'ETH')
eq('solana explorer is devnet', CHAIN_CONFIG.SOLANA.explorerTx('abc').includes('cluster=devnet'), true)
eq('evm explorer is base sepolia', CHAIN_CONFIG.ETHEREUM.explorerTx('abc').includes('sepolia.basescan.org'), true)

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
