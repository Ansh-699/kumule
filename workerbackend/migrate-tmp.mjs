import { Pool, neonConfig } from '@neondatabase/serverless'
import ws from 'ws'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'

neonConfig.webSocketConstructor = ws

const APPLY = process.env.APPLY === 'yes'
const pool = new Pool({ connectionString: process.env.PROD_DB })
const client = await pool.connect()

try {
    const { rows: done } = await client.query(
        'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'
    )
    const applied = new Set(done.map(r => r.migration_name))

    const all = readdirSync('prisma/migrations')
        .filter(d => !d.endsWith('.toml'))
        .sort()
    const pending = all.filter(m => !applied.has(m))

    console.log('  migrations on disk :', all.length)
    console.log('  already applied    :', applied.size)
    console.log('  pending            :', pending.length, pending.length ? '-> ' + pending.join(', ') : '')
    if (!pending.length) { console.log('\n  nothing to do'); process.exit(0) }

    for (const name of pending) {
        const file = `prisma/migrations/${name}/migration.sql`
        const raw = readFileSync(file, 'utf8')
        // Prisma DDL: one statement per block, no functions or string literals containing ';'
        const statements = raw
            .split(';')
            .map(s => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').trim())
            .filter(Boolean)
        console.log(`\n  ${name}: ${statements.length} statements`)
        if (!APPLY) {
            for (const s of statements.slice(0, 3)) console.log('    ', s.split('\n')[0].slice(0, 78))
            console.log('     ... (dry run, nothing executed)')
            continue
        }

        // One transaction for the whole migration: Postgres DDL is transactional, so a
        // failure anywhere leaves production exactly as it was rather than half-migrated.
        await client.query('BEGIN')
        try {
            for (const s of statements) await client.query(s)
            await client.query(
                `INSERT INTO _prisma_migrations
                   (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
                 VALUES ($1, $2, now(), $3, NULL, NULL, now(), $4)`,
                [randomUUID(), createHash('sha256').update(readFileSync(file)).digest('hex'), name, statements.length]
            )
            await client.query('COMMIT')
            console.log(`     applied and recorded`)
        } catch (e) {
            await client.query('ROLLBACK')
            console.error(`     FAILED, rolled back: ${e.message}`)
            process.exit(1)
        }
    }
} finally {
    client.release()
    await pool.end()
}
