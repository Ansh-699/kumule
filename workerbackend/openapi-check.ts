// Asserts src/openapi.ts documents every route src/index.ts mounts. Run: bun openapi-check.ts
//
// String-level: no server, no network, no DB. This never opens src/index.ts for anything but its
// own route list, and it never touches src/openapi.ts's content beyond reading its keys — a
// route added to index.ts without a matching openapi.ts entry has to fail here, not drift
// silently until someone notices the docs lied.

import { readFileSync } from 'fs'
import { openAPISpec } from './src/openapi'

let failures = 0

const indexSrc = readFileSync('./src/index.ts', 'utf8')
const livePaths = new Set(
    [...indexSrc.matchAll(/app\.(?:get|post|put|delete)\('([^']+)'/g)]
        .map((m) => m[1].replace(/:([a-zA-Z]+)/g, '{$1}'))
)
const documented = new Set(Object.keys(openAPISpec.paths))

console.log(`live paths: ${livePaths.size}, documented paths: ${documented.size}`)

const missing = [...livePaths].filter((p) => !documented.has(p))
if (missing.length === 0) {
    console.log('  ok   every live route is documented')
} else {
    failures++
    console.error(`  FAIL ${missing.length} live route(s) missing from openapi.ts:`)
    for (const p of missing.sort()) console.error(`    ${p}`)
}

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
