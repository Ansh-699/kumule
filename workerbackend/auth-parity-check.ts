// Regression check for issue 002 (auth-parity / seam 2): the six album.ts mutation routes
// and two of upload.ts's four routes (files, audio) must carry adminAuth in index.ts's route
// table; upload/image and upload/metadata must stay public for the unauthenticated mint flow
// (frontend/src/pages/CreatePage.tsx calls them with no admin key).
//
// Imports the real exported `app` from index.ts, not a rebuilt toy router, so this fails if
// adminAuth is wired to the wrong route, not just if it's entirely absent.
//
// Run: npx tsx auth-parity-check.ts
//
import app from './src/index'

const REAL_KEY = 'a-long-random-value-set-in-cf-secrets'
const WRONG_KEY = 'definitely-not-the-real-key'
const env = { ADMIN_API_KEY: REAL_KEY }

const call = (method: string, path: string) =>
    app.request(path, { method, headers: { 'X-Admin-API-Key': WRONG_KEY } }, env)

let failures = 0

// [method, path to call, label to print]
const gated: [string, string, string][] = [
    ['POST', '/api/albums', 'POST /api/albums'],
    ['PUT', '/api/albums/x1', 'PUT /api/albums/:id'],
    ['DELETE', '/api/albums/x1', 'DELETE /api/albums/:id'],
    ['POST', '/api/albums/x1/tracks', 'POST /api/albums/:id/tracks'],
    ['PUT', '/api/albums/x1/tracks/t1', 'PUT /api/albums/:id/tracks/:trackId'],
    ['DELETE', '/api/albums/x1/tracks/t1', 'DELETE /api/albums/:id/tracks/:trackId'],
    ['POST', '/api/upload/files', 'POST /api/upload/files'],
    ['POST', '/api/upload/audio', 'POST /api/upload/audio'],
]

const publicRoutes: [string, string, string][] = [
    ['POST', '/api/upload/image', 'POST /api/upload/image'],
    ['POST', '/api/upload/metadata', 'POST /api/upload/metadata'],
]

console.log('admin-gated mutation routes (must be 401 with a wrong key):')
for (const [method, path, label] of gated) {
    const res = await call(method, path)
    if (res.status === 401) {
        console.log(`  ok   ${label} -> ${res.status}`)
    } else {
        failures++
        console.error(`  FAIL ${label} -> ${res.status} (expected gated=true)`)
    }
}

console.log('\npublic mint-flow upload routes (must stay reachable, never 401):')
for (const [method, path, label] of publicRoutes) {
    const res = await call(method, path)
    if (res.status !== 401) {
        console.log(`  ok   ${label} -> ${res.status}`)
    } else {
        failures++
        console.error(`  FAIL ${label} -> ${res.status} (expected gated=false)`)
    }
}

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
