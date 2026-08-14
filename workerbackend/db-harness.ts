// Lets the checks run the real handlers against a real Postgres.
//
// withPrisma builds a PrismaNeon adapter, and that adapter does not speak Postgres over TCP -
// it speaks it over a WebSocket to Neon's proxy. So "point it at localhost" is not a connection
// string change, and swapping in @prisma/adapter-pg for tests would mean the checks exercise a
// driver production never uses.
//
// The Neon driver has the seam already: neonConfig.wsProxy. Point it at a relay that unwraps the
// WebSocket back into a TCP socket and every query runs through the exact adapter, client and
// handler code that ships. Nothing in src/ is aware of this file.
//
// Requires a Postgres on POSTGRES_URL (default localhost:55432), e.g.
//   podman run -d --name kumule-pg -e POSTGRES_PASSWORD=kumule -e POSTGRES_USER=kumule \
//     -e POSTGRES_DB=kumule -p 55432:5432 docker.io/library/postgres:16-alpine
//   DATABASE_URL=postgresql://kumule:kumule@localhost:55432/kumule npx prisma migrate deploy

import net from 'node:net'
import { WebSocketServer } from 'ws'
import WebSocket from 'ws'
import { neonConfig } from '@neondatabase/serverless'

export const POSTGRES_URL =
    process.env.POSTGRES_URL ?? 'postgresql://kumule:kumule@127.0.0.1:55432/kumule'

/**
 * Start the relay and rewire the Neon driver onto it.
 *
 * The proxy protocol is deliberately thin: the driver opens `ws://host/v1?address=host:port`
 * and then sends raw Postgres wire bytes, so the relay is a byte pipe and nothing here has to
 * understand the protocol it is carrying.
 */
export const startLocalNeonProxy = async (port = 5488): Promise<() => Promise<void>> => {
    const wss = new WebSocketServer({ port, host: '127.0.0.1' })

    wss.on('connection', (ws, req) => {
        const address = new URL(req.url ?? '', 'http://x').searchParams.get('address') ?? ''
        const [host, portText] = address.split(':')
        const tcp = net.connect({ host, port: Number(portText) })

        // Postgres may answer before the driver finishes speaking, so both directions are wired
        // up immediately and the socket is corked until it is open.
        const pending: Buffer[] = []
        let open = false
        tcp.on('connect', () => {
            open = true
            for (const chunk of pending) tcp.write(chunk)
            pending.length = 0
        })
        tcp.on('data', (data) => ws.readyState === WebSocket.OPEN && ws.send(data))
        tcp.on('close', () => ws.close())
        tcp.on('error', () => ws.close())

        ws.on('message', (data: Buffer) => (open ? tcp.write(data) : pending.push(data)))
        ws.on('close', () => tcp.destroy())
    })

    await new Promise<void>((resolve) => wss.once('listening', resolve))

    neonConfig.webSocketConstructor = WebSocket as any
    neonConfig.wsProxy = (host, p) => `127.0.0.1:${port}/v1?address=${host}:${p}`
    // Both of these exist because Neon's own proxy terminates TLS and accepts a pipelined
    // startup. The relay does neither, so saying so is not a shortcut - it is the truth.
    neonConfig.useSecureWebSocket = false
    neonConfig.pipelineConnect = false

    return () => new Promise<void>((resolve) => wss.close(() => resolve()))
}

/** Truncate every table so each check starts from a known empty database. */
export const resetDatabase = async (): Promise<void> => {
    const { PrismaClient } = await import('@prisma/client')
    const { PrismaNeon } = await import('@prisma/adapter-neon')
    const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: POSTGRES_URL }) })
    try {
        const tables = await prisma.$queryRaw<{ tablename: string }[]>`
            SELECT tablename::text FROM pg_tables
            WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
        `
        if (tables.length === 0) throw new Error('no tables: run prisma migrate deploy first')
        const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ')
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
    } finally {
        await prisma.$disconnect()
    }
}

/** A client on the same transport the handlers use, for asserting on what they wrote. */
export const inspect = async <T>(fn: (prisma: any) => Promise<T>): Promise<T> => {
    const { PrismaClient } = await import('@prisma/client')
    const { PrismaNeon } = await import('@prisma/adapter-neon')
    const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: POSTGRES_URL }) })
    try {
        return await fn(prisma)
    } finally {
        await prisma.$disconnect()
    }
}
