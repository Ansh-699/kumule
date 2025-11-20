
import { Hono } from 'hono'
import { Buffer } from 'buffer'
globalThis.Buffer  = Buffer;
import { searchNftByAsset } from './searchnftbyasset'
import { searchNftByOwner } from './searchnftbyowner'
import { transferNft } from './transfer'
import { mintNft } from './mint'
import { listNft, buyNft, cancelListing, getListings } from './escrow'
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

export default app

