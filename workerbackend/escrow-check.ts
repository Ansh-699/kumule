// Asserts for src/escrow.ts's INSTRUCTION_DISCRIMINATORS. Run: npx tsx escrow-check.ts
//
// Seven call sites used to read `getIDL().instructions[N].discriminator` by position, so
// reordering that array - an easy mistake in an unrelated edit - would silently point every
// one of them at the wrong instruction. This pins the replacement name-keyed table against the
// exact byte literals read directly from getIDL()'s inline discriminators in escrow.ts
// (lines 87-160 as read 2026-08-13), not recomputed from the constant itself, so the check
// cannot pass by accident from a tautology.

import { INSTRUCTION_DISCRIMINATORS } from './src/escrow'

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

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
