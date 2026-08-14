// Asserts for src/escrow.ts's INSTRUCTION_DISCRIMINATORS. Run: npx tsx escrow-check.ts
//
// Seven call sites used to read `getIDL().instructions[N].discriminator` by position, so
// reordering that array - an easy mistake in an unrelated edit - would silently point every
// one of them at the wrong instruction. This pins the replacement name-keyed table against the
// exact byte literals read directly from getIDL()'s inline discriminators in escrow.ts
// (lines 87-160 as read 2026-08-13), not recomputed from the constant itself, so the check
// cannot pass by accident from a tautology.

import { INSTRUCTION_DISCRIMINATORS, u64ToLeBytes } from './src/escrow'

let failures = 0
const eq = (name: string, got: unknown, want: unknown) => {
    const g = JSON.stringify(got), w = JSON.stringify(want)
    if (g === w) { console.log(`  ok   ${name}`) } else { failures++; console.error(`  FAIL ${name}: got ${g} want ${w}`) }
}

// Ground truth: the discriminator array literals inline in getIDL() in src/escrow.ts, copied
// verbatim, never imported from INSTRUCTION_DISCRIMINATORS itself.
const EXPECTED: Record<string, number[]> = {
    create_escrow: [253, 215, 165, 116, 36, 108, 68, 80],
    deposit_asset: [107, 93, 89, 87, 226, 203, 154, 19],
    buy_asset: [197, 37, 177, 1, 180, 23, 175, 98],
    cancel_escrow: [156, 203, 54, 179, 38, 72, 33, 21],
    close_escrow: [139, 171, 94, 146, 191, 91, 144, 50],
    admin_resolve: [90, 215, 29, 95, 17, 61, 118, 229],
}

console.log('INSTRUCTION_DISCRIMINATORS shape:')
eq('exactly six keys', Object.keys(INSTRUCTION_DISCRIMINATORS).sort(), Object.keys(EXPECTED).sort())

console.log('\nINSTRUCTION_DISCRIMINATORS bytes (pinned to getIDL() literals):')
for (const name of Object.keys(EXPECTED)) {
    eq(name, INSTRUCTION_DISCRIMINATORS[name], EXPECTED[name])
}

// u64ToLeBytes replaces anchor's `new BN(v).toArray('le', 8)` for the escrow price. Verified
// against an independent stdlib oracle - DataView.setBigUint64 - rather than against a
// hand-written expectation, so this cannot pass by copying the implementation's own bug.
//
// Overflow matters as much as correctness: BN.toArray('le', 8) throws on a value too large for
// 8 bytes, and a silent wrap would list an asset at a price nobody chose.
const oracleU64Le = (v: bigint): number[] => {
    const buf = new ArrayBuffer(8)
    new DataView(buf).setBigUint64(0, v, true)
    return Array.from(new Uint8Array(buf))
}

console.log('')
console.log('u64ToLeBytes matches DataView.setBigUint64 (little-endian):')
const u64Cases: bigint[] = [
    0n,
    1n,
    255n,
    256n,
    1_000_000_000n,                 // 1 SOL in lamports
    1_100_000_000n,                 // the 1.1 SOL case the float bug corrupted
    2_000_000_000n,
    0xffn,
    0x1234_5678_9abc_def0n,
    18_446_744_073_709_551_615n,    // u64 max
]
for (const v of u64Cases) {
    const got = u64ToLeBytes(v)
    const want = oracleU64Le(v)
    const same = got.length === want.length && got.every((b, i) => b === want[i])
    if (same) {
        console.log(`  ok   ${v} -> [${got.join(',')}]`)
    } else {
        console.log(`  FAIL ${v} -> [${got.join(',')}] expected [${want.join(',')}]`)
        failures++
    }
}

// Round-trip through the same reader the program would use.
for (const v of u64Cases) {
    const bytes = new Uint8Array(u64ToLeBytes(v))
    const back = new DataView(bytes.buffer).getBigUint64(0, true)
    if (back === v) console.log(`  ok   ${v} round-trips`)
    else { console.log(`  FAIL ${v} round-tripped to ${back}`); failures++ }
}

console.log('')
console.log('u64ToLeBytes refuses values it cannot represent:')
for (const bad of [-1n, 18_446_744_073_709_551_616n, 1n << 100n]) {
    let threw = false
    try { u64ToLeBytes(bad) } catch { threw = true }
    if (threw) console.log(`  ok   ${bad} rejected`)
    else { console.log(`  FAIL ${bad} was accepted and would wrap`); failures++ }
}

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
