#!/usr/bin/env node
// Reports database drift against schema.prisma, and optionally repairs it.
//
//   node prisma/apply-bootstrap.mjs           # report only, changes nothing
//   node prisma/apply-bootstrap.mjs --apply   # run prisma/bootstrap.sql
//
// Reads the connection string from DATABASE_URL, falling back to .dev.vars. It is never
// passed as an argument, so it stays out of shell history and process listings.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))

const connectionString = (() => {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const devVars = join(here, '..', '.dev.vars')
  if (existsSync(devVars)) {
    const m = readFileSync(devVars, 'utf8').match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m)
    if (m) return m[1]
  }
  return null
})()

if (!connectionString) {
  console.error('No connection string. Set DATABASE_URL or add it to .dev.vars.')
  process.exit(1)
}

const apply = process.argv.includes('--apply')
const client = new pg.Client({ connectionString })
await client.connect()

// Redact before printing anything, so logs never carry the password.
const target = connectionString.replace(/\/\/[^@]*@/, '//***@')
console.log(`Target: ${target}`)
console.log(`Mode:   ${apply ? 'APPLY' : 'report only (pass --apply to repair)'}\n`)

const bootstrapSql = readFileSync(join(here, 'bootstrap.sql'), 'utf8')
const wanted = [...bootstrapSql.matchAll(/CREATE TABLE IF NOT EXISTS "([^"]+)"/g)].map(m => m[1])

const { rows } = await client.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`)
const present = new Set(rows.map(r => r.table_name))

const missing = wanted.filter(t => !present.has(t))
console.log(`Tables in schema.prisma: ${wanted.length}`)
console.log(`Present in database:     ${wanted.length - missing.length}`)
if (missing.length) console.log(`MISSING:                ${missing.join(', ')}`)

// Column-level drift on the tables that do exist.
const colDrift = []
for (const table of wanted.filter(t => present.has(t))) {
  const declared = [...bootstrapSql
    .matchAll(new RegExp(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "([^"]+)"`, 'g'))]
    .map(m => m[1])
  const live = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1`, [table])
  const liveSet = new Set(live.rows.map(r => r.column_name))
  const gone = declared.filter(c => !liveSet.has(c))
  if (gone.length) colDrift.push(`${table}: ${gone.join(', ')}`)
}
if (colDrift.length) {
  console.log(`\nMissing columns on existing tables:`)
  for (const d of colDrift) console.log(`  ${d}`)
}

if (!missing.length && !colDrift.length) {
  console.log('\nNo drift. Database matches schema.prisma.')
  await client.end()
  process.exit(0)
}

if (!apply) {
  console.log('\nRe-run with --apply to create the missing tables and columns.')
  console.log('bootstrap.sql only adds; it never drops a table, column, or row.')
  await client.end()
  process.exit(0)
}

console.log('\nApplying bootstrap.sql ...')
try {
  await client.query(bootstrapSql)
  console.log('Applied. Re-run without --apply to confirm no drift remains.')
} catch (e) {
  // bootstrap.sql is wrapped in BEGIN/COMMIT, so a failure leaves the database untouched.
  console.error(`\nFAILED, rolled back, nothing changed:\n  ${e.message}`)
  if (/unique|duplicate/i.test(e.message)) {
    console.error('\n  A UNIQUE column was added to a populated table and the backfill default')
    console.error('  collided. Backfill that column with real values first, then re-run.')
  }
  process.exitCode = 1
}
await client.end()
