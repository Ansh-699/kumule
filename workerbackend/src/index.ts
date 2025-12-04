import { Hono } from 'hono'
import { Buffer } from 'buffer'
(globalThis as any).Buffer = Buffer;
import { searchNftByAsset } from './searchnftbyasset'
import { searchNftByOwner } from './searchnftbyowner'
import { transferNft } from './transfer'
import { mintNft } from './mint'
import { listNft, buyNft, cancelListing, getListings } from './escrow'
import { createCharge, verifyPayment } from './payment'
import { withPrisma, getConnectionString } from './db'
import { cors } from 'hono/cors'
const app = new Hono<{ Bindings: CloudflareBindings }>()

app.use(cors())

app.use('*', async (c, next) => {
  const url = new URL(c.req.url)
  const normalizedPath = url.pathname.replace(/\/{2,}/g, '/')
  if (normalizedPath !== url.pathname) {
    return c.redirect(`${normalizedPath}${url.search}`, 307)
  }
  await next()
})

app.get('/', (c) => {
  const owner = c.req.query('owner')
  if (owner) {
    return searchNftByOwner(c)
  }
  return searchNftByAsset(c)
})
app.get('/owner', searchNftByOwner)
app.post('/transfer', transferNft)
app.post('/mint', mintNft)
app.post('/list', listNft)
app.post('/buy', buyNft)
app.post('/cancel', cancelListing)
app.get('/listings', getListings)

// Payment routes
app.post('/api/payment/create', createCharge)
app.get('/api/payment/status/:id', verifyPayment)

import { handleWebhook, handlePaymentWebhook, getPaymentLogs, getTransactionHistory } from './webhook'

// Payment webhooks - unified endpoint and legacy Coinbase endpoint
app.post('/api/payments/webhook', handlePaymentWebhook)
app.post('/api/webhooks/coinbase', handleWebhook)

// Payment logs and transaction history endpoints
app.get('/api/payments/logs', getPaymentLogs)
app.get('/api/payments/transactions', getTransactionHistory)

// Simple DB debug route: runs a trivial Prisma query
app.get('/debug/db', async (c) => {
  try {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) {
      return c.json({ ok: false, error: 'Database connection not configured (need HYPERDRIVE or DATABASE_URL)' }, 500)
    }

    const result = await withPrisma(connectionString, async (prisma) => {
      const userCount = await prisma.user.count()
      const nftCount = await prisma.nft.count()
      const transactionCount = await prisma.transaction.count()
      return { userCount, nftCount, transactionCount }
    })

    return c.json({ ok: true, ...result })
  } catch (e: any) {
    console.error('Debug DB error:', e)
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

export default app

