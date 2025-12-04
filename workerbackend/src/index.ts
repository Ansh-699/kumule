import { Hono } from 'hono'
import { Buffer } from 'buffer'
(globalThis as any).Buffer = Buffer;
import { cors } from 'hono/cors'
import { searchNftByAsset } from './searchnftbyasset'
import { searchNftByOwner } from './searchnftbyowner'
import { transferNft } from './transfer'
import { mintNft } from './mint'
import { listNft, buyNft, cancelListing, getListings, adminResolveEscrow } from './escrow'
import { createCharge, verifyPayment, checkPaymentStatus, cancelPayment } from './payment'
import { handleWebhook, handlePaymentWebhook, getPaymentLogs, getTransactionHistory } from './webhook'
import { createDispute, getDisputes, getDispute, resolveDispute, markDisputeRefunded } from './dispute'
import { adminAuth, getAdminDashboard } from './admin'
import { getOrCreateRewardAccount, recordInteraction, claimNftReward, getAvailableRewards } from './reward'
import { withPrisma, getConnectionString } from './db'

const app = new Hono<{ Bindings: CloudflareBindings }>()

// Health check endpoint - register FIRST before any middleware
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Test endpoint without any processing
app.get('/test', (c) => {
  return c.text('OK')
})

// CORS middleware with explicit origin handling
app.use('*', async (c, next) => {
  const origin = c.req.header('origin')
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Access-Control-Allow-Credentials', 'true')
  } else {
    c.header('Access-Control-Allow-Origin', '*')
  }
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-API-Key')
  
  if (c.req.method === 'OPTIONS') {
    return c.text('', 204)
  }
  
  await next()
})

// Simplified path normalization middleware - skip for health/test endpoints
app.use('*', async (c, next) => {
  const pathname = new URL(c.req.url).pathname
  if (pathname === '/health' || pathname === '/test') {
    return await next()
  }
  
  try {
    const normalizedPath = pathname.replace(/\/{2,}/g, '/')
    if (normalizedPath !== pathname) {
      return c.redirect(`${normalizedPath}${new URL(c.req.url).search}`, 307)
    }
    await next()
  } catch (error) {
    // If URL parsing fails, just continue
    await next()
  }
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
app.post('/api/payment/check-status/:chargeId', checkPaymentStatus)
app.post('/api/payment/cancel/:chargeId', cancelPayment)

// Payment webhooks - unified endpoint and legacy Coinbase endpoint
app.post('/api/payments/webhook', handlePaymentWebhook)
app.post('/api/webhooks/coinbase', handleWebhook)

// Payment logs and transaction history endpoints
app.get('/api/payments/logs', getPaymentLogs)
app.get('/api/payments/transactions', getTransactionHistory)

// Dispute routes
app.post('/api/disputes', createDispute)
app.get('/api/disputes', getDisputes)
app.get('/api/disputes/:id', getDispute)
app.post('/api/disputes/:id/resolve', resolveDispute)
app.post('/api/disputes/:id/refunded', markDisputeRefunded)

// Admin routes (protected with API key)
app.get('/api/admin/dashboard', adminAuth, getAdminDashboard)
app.post('/api/escrow/admin_resolve', adminAuth, adminResolveEscrow)

// Reward system routes
app.get('/api/rewards/account', getOrCreateRewardAccount)
app.post('/api/rewards/interaction', recordInteraction)
app.post('/api/rewards/claim', claimNftReward)
app.get('/api/rewards/available', getAvailableRewards)

// Admin reward routes
import { mintRewardNft, getAllRewardNfts, updateRewardNft, deleteRewardNft } from './admin-rewards'
import { fillMeter, resetMeter } from './reward'
import { createRewardDraft, getAllRewardDrafts, updateRewardDraft, deleteRewardDraft } from './reward-drafts'
app.post('/api/admin/rewards/mint', adminAuth, mintRewardNft)
app.get('/api/admin/rewards', adminAuth, getAllRewardNfts)
app.put('/api/admin/rewards/:id', adminAuth, updateRewardNft)
app.delete('/api/admin/rewards/:id', adminAuth, deleteRewardNft)
app.post('/api/admin/rewards/fill-meter', adminAuth, fillMeter)
app.post('/api/admin/rewards/reset-meter', adminAuth, resetMeter)

// Reward draft routes
app.post('/api/admin/rewards/drafts', adminAuth, createRewardDraft)
app.get('/api/admin/rewards/drafts', adminAuth, getAllRewardDrafts)
app.put('/api/admin/rewards/drafts/:id', adminAuth, updateRewardDraft)
app.delete('/api/admin/rewards/drafts/:id', adminAuth, deleteRewardDraft)

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

