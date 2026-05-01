import { Hono } from 'hono'
import { swaggerUI } from '@hono/swagger-ui'
import { Buffer } from 'buffer'
(globalThis as any).Buffer = Buffer;
import { openAPISpec } from './openapi'
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
import { createEvent, listEvents, joinEvent, deleteEvent } from './event'
import { getEventRewardStatus, retryEventRewardMinting } from './event-auto-mint'

const app = new Hono<{ Bindings: CloudflareBindings }>()

// ==================== API DOCUMENTATION ====================
// Swagger UI with custom wallet adapter integration
app.get('/docs', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kumule NFT Marketplace API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
    .swagger-ui .topbar { display: none; }
    .wallet-bar {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .wallet-bar h1 { margin: 0; font-size: 20px; font-weight: 600; }
    .wallet-bar .subtitle { opacity: 0.9; font-size: 12px; margin-top: 2px; }
    .wallet-section { display: flex; align-items: center; gap: 12px; }
    .wallet-address { 
      background: rgba(255,255,255,0.2); 
      padding: 6px 12px; 
      border-radius: 6px; 
      font-size: 13px;
      font-family: monospace;
    }
    .connect-btn {
      background: #512da8;
      border: none;
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
    }
    .connect-btn:hover { background: #4527a0; transform: translateY(-1px); }
    .connect-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .connect-btn.connected { background: #2e7d32; }
    .phantom-icon { width: 20px; height: 20px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; }
    .status-dot.connected { background: #4caf50; }
    .status-dot.disconnected { background: #f44336; }
    .info-section {
      background: #f5f5f5;
      padding: 15px 20px;
      border-bottom: 1px solid #ddd;
      font-size: 13px;
      color: #666;
    }
    .info-section code { 
      background: #e0e0e0; 
      padding: 2px 6px; 
      border-radius: 4px; 
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="wallet-bar">
    <div>
      <h1>🎵 Kumule NFT Marketplace API</h1>
      <div class="subtitle">Solana NFT Platform • Devnet</div>
    </div>
    <div class="wallet-section">
      <div id="walletStatus" class="wallet-address" style="display: none;">
        <span class="status-dot connected"></span>
        <span id="walletAddressDisplay"></span>
      </div>
      <button id="connectBtn" class="connect-btn" onclick="connectWallet()">
        <img src="https://phantom.app/img/phantom-icon-purple.svg" class="phantom-icon" alt="">
        Connect Phantom
      </button>
    </div>
  </div>
  
  <div class="info-section">
    <strong>🔐 Wallet Integration:</strong> Connect your Phantom wallet to test NFT minting and transfers. 
    Transactions requiring signatures will prompt your wallet.
    <br><br>
    <strong>🔑 Admin Endpoints:</strong> Use <code>X-Admin-API-Key: anshtyagi</code> header. Click "Authorize" button below and enter: <strong>anshtyagi</strong>
    <br><br>
    <strong>📋 Test Data:</strong> Most fields are pre-filled with working devnet data. Your wallet: <code>anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm</code>
  </div>
  
  <div id="swagger-ui"></div>
  
  <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-bundle.js"></script>
  <script>
    let walletPublicKey = null;
    let phantomProvider = null;
    
    // Check if Phantom is installed
    const getProvider = () => {
      if ('phantom' in window) {
        const provider = window.phantom?.solana;
        if (provider?.isPhantom) {
          return provider;
        }
      }
      window.open('https://phantom.app/', '_blank');
      return null;
    };
    
    async function connectWallet() {
      const btn = document.getElementById('connectBtn');
      
      try {
        phantomProvider = getProvider();
        if (!phantomProvider) {
          alert('Please install Phantom wallet');
          return;
        }
        
        btn.disabled = true;
        btn.textContent = 'Connecting...';
        
        const resp = await phantomProvider.connect();
        walletPublicKey = resp.publicKey.toString();
        
        // Update UI
        btn.className = 'connect-btn connected';
        btn.innerHTML = '<span class="status-dot connected"></span> Connected';
        
        document.getElementById('walletStatus').style.display = 'flex';
        document.getElementById('walletAddressDisplay').textContent = 
          walletPublicKey.slice(0, 4) + '...' + walletPublicKey.slice(-4);
        
        // Store for API calls
        window.solanaWallet = {
          publicKey: walletPublicKey,
          signTransaction: async (tx) => {
            return await phantomProvider.signTransaction(tx);
          },
          signMessage: async (message) => {
            const encodedMessage = new TextEncoder().encode(message);
            return await phantomProvider.signMessage(encodedMessage, 'utf8');
          }
        };
        
        console.log('Wallet connected:', walletPublicKey);
        
      } catch (err) {
        console.error('Connection error:', err);
        btn.disabled = false;
        btn.innerHTML = '<img src="https://phantom.app/img/phantom-icon-purple.svg" class="phantom-icon" alt=""> Connect Phantom';
        if (err.code !== 4001) { // User rejected
          alert('Failed to connect wallet: ' + err.message);
        }
      }
    }
    
    // Listen for wallet events
    if (window.phantom?.solana) {
      window.phantom.solana.on('connect', (publicKey) => {
        console.log('Wallet connected event:', publicKey.toString());
      });
      
      window.phantom.solana.on('disconnect', () => {
        walletPublicKey = null;
        const btn = document.getElementById('connectBtn');
        btn.className = 'connect-btn';
        btn.innerHTML = '<img src="https://phantom.app/img/phantom-icon-purple.svg" class="phantom-icon" alt=""> Connect Phantom';
        btn.disabled = false;
        document.getElementById('walletStatus').style.display = 'none';
      });
      
      // Auto-connect if already connected
      window.phantom.solana.connect({ onlyIfTrusted: true }).then(resp => {
        walletPublicKey = resp.publicKey.toString();
        window.solanaWallet = { publicKey: walletPublicKey };
        const btn = document.getElementById('connectBtn');
        btn.className = 'connect-btn connected';
        btn.innerHTML = '<span class="status-dot connected"></span> Connected';
        document.getElementById('walletStatus').style.display = 'flex';
        document.getElementById('walletAddressDisplay').textContent = 
          walletPublicKey.slice(0, 4) + '...' + walletPublicKey.slice(-4);
      }).catch(() => {});
    }
    
    // Initialize Swagger UI
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "BaseLayout",
        requestInterceptor: (req) => {
          // Auto-fill wallet address if connected
          if (walletPublicKey && req.body) {
            try {
              const body = JSON.parse(req.body);
              if (body.owner === '' || body.owner === 'string') {
                body.owner = walletPublicKey;
              }
              if (body.seller === '' || body.seller === 'string') {
                body.seller = walletPublicKey;
              }
              if (body.buyer === '' || body.buyer === 'string') {
                body.buyer = walletPublicKey;
              }
              if (body.walletAddress === '' || body.walletAddress === 'string') {
                body.walletAddress = walletPublicKey;
              }
              if (body.creatorWallet === '' || body.creatorWallet === 'string') {
                body.creatorWallet = walletPublicKey;
              }
              if (body.adminWallet === '' || body.adminWallet === 'string') {
                body.adminWallet = walletPublicKey;
              }
              req.body = JSON.stringify(body);
            } catch (e) {}
          }
          return req;
        }
      });
    };
  </script>
</body>
</html>`;
  return c.html(html);
})

// OpenAPI JSON specification
app.get('/openapi.json', (c) => {
  return c.json(openAPISpec)
})

// Full API Documentation Page (PDF-style)
app.get('/api-docs', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kumule NFT Marketplace - API Documentation</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code&display=swap');
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Inter', sans-serif;
            line-height: 1.6;
            color: #1a1a2e;
            background: #ffffff;
            padding: 40px;
            max-width: 1000px;
            margin: 0 auto;
        }
        
        @media print {
            body { padding: 20px; }
            .page-break { page-break-before: always; }
            pre { white-space: pre-wrap; word-wrap: break-word; }
            .no-print { display: none; }
        }
        
        h1 { font-size: 32px; font-weight: 700; color: #6366f1; margin-bottom: 10px; border-bottom: 3px solid #6366f1; padding-bottom: 10px; }
        h2 { font-size: 24px; font-weight: 600; color: #1a1a2e; margin-top: 40px; margin-bottom: 20px; border-left: 4px solid #6366f1; padding-left: 15px; }
        h3 { font-size: 18px; font-weight: 600; color: #374151; margin-top: 25px; margin-bottom: 15px; }
        h4 { font-size: 16px; font-weight: 600; color: #4b5563; margin-top: 20px; margin-bottom: 10px; }
        p { margin-bottom: 15px; color: #4b5563; }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
            padding: 30px;
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            border-radius: 12px;
            color: white;
        }
        .header h1 { color: white; border-bottom: none; font-size: 36px; }
        .header p { color: rgba(255,255,255,0.9); font-size: 18px; }
        .version { background: rgba(255,255,255,0.2); padding: 5px 15px; border-radius: 20px; display: inline-block; margin-top: 10px; font-size: 14px; }
        
        .nav-bar {
            background: #f8fafc;
            padding: 15px 20px;
            border-radius: 8px;
            margin-bottom: 30px;
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
            align-items: center;
        }
        .nav-bar a {
            color: #6366f1;
            text-decoration: none;
            padding: 8px 16px;
            border-radius: 6px;
            font-weight: 500;
            transition: all 0.2s;
        }
        .nav-bar a:hover { background: #6366f1; color: white; }
        .nav-bar a.active { background: #6366f1; color: white; }
        
        .info-box { background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .info-box.warning { background: #fffbeb; border-color: #f59e0b; }
        .info-box.success { background: #f0fdf4; border-color: #22c55e; }
        .info-box h4 { margin-top: 0; color: #0ea5e9; }
        .info-box.warning h4 { color: #f59e0b; }
        .info-box.success h4 { color: #22c55e; }
        
        pre { background: #1e1e2e; color: #cdd6f4; padding: 20px; border-radius: 8px; overflow-x: auto; font-family: 'Fira Code', monospace; font-size: 13px; margin: 15px 0; }
        code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-family: 'Fira Code', monospace; font-size: 14px; color: #6366f1; }
        pre code { background: none; padding: 0; color: inherit; }
        
        table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
        th, td { border: 1px solid #e5e7eb; padding: 12px 15px; text-align: left; }
        th { background: #f8fafc; font-weight: 600; color: #374151; }
        tr:nth-child(even) { background: #f9fafb; }
        
        .method { display: inline-block; padding: 4px 10px; border-radius: 4px; font-weight: 600; font-size: 12px; text-transform: uppercase; }
        .method.get { background: #dbeafe; color: #1d4ed8; }
        .method.post { background: #dcfce7; color: #16a34a; }
        .method.put { background: #fef3c7; color: #d97706; }
        .method.delete { background: #fee2e2; color: #dc2626; }
        
        .endpoint { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 15px 0; }
        .endpoint-header { display: flex; align-items: center; gap: 15px; margin-bottom: 15px; }
        .endpoint-path { font-family: 'Fira Code', monospace; font-size: 16px; font-weight: 500; }
        
        .toc { background: #f8fafc; border-radius: 8px; padding: 25px; margin: 30px 0; }
        .toc h3 { margin-top: 0; }
        .toc ul { columns: 2; list-style: none; }
        .toc li { padding: 5px 0; }
        .toc a { color: #6366f1; text-decoration: none; }
        
        .diagram { background: #1e1e2e; color: #a6e3a1; padding: 20px; border-radius: 8px; font-family: 'Fira Code', monospace; font-size: 11px; line-height: 1.4; overflow-x: auto; white-space: pre; }
        
        .status-badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
        .status-badge.success { background: #dcfce7; color: #16a34a; }
        .status-badge.error { background: #fee2e2; color: #dc2626; }
        
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        @media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } .toc ul { columns: 1; } }
        
        footer { margin-top: 60px; padding-top: 30px; border-top: 1px solid #e5e7eb; text-align: center; color: #9ca3af; }
    </style>
</head>
<body>
    <div class="nav-bar no-print">
        <a href="/docs">🔧 Swagger UI</a>
        <a href="/api-docs" class="active">📄 Full Documentation</a>
        <a href="/openapi.json">📋 OpenAPI JSON</a>
        <a href="#" onclick="window.print(); return false;">🖨️ Print/PDF</a>
    </div>

    <div class="header">
        <h1>🎨 Kumule NFT Marketplace</h1>
        <p>Complete API Documentation & Testing Guide</p>
        <div class="version">Version 1.0.0 | January 2026</div>
    </div>

    <div class="toc">
        <h3>📋 Table of Contents</h3>
        <ul>
            <li><a href="#overview">1. Overview</a></li>
            <li><a href="#architecture">2. System Architecture</a></li>
            <li><a href="#authentication">3. Authentication</a></li>
            <li><a href="#base-url">4. Base URL & Setup</a></li>
            <li><a href="#endpoints">5. API Endpoints</a></li>
            <li><a href="#testing">6. Testing Guide</a></li>
            <li><a href="#examples">7. Code Examples</a></li>
            <li><a href="#errors">8. Error Handling</a></li>
            <li><a href="#flows">9. Flow Diagrams</a></li>
            <li><a href="#security">10. Security</a></li>
        </ul>
    </div>

    <h2 id="overview">1. Overview</h2>
    <p>Kumule is a decentralized NFT marketplace built on Solana Devnet. It supports artwork, music albums, event badges, and includes a comprehensive reward system.</p>
    
    <div class="grid-2">
        <div class="info-box success">
            <h4>✅ Live API</h4>
            <p><strong>Production:</strong><br><code>https://kumele-backend.ansht.workers.dev</code></p>
            <p><strong>API Docs:</strong><br><code>https://kumele-backend.ansht.workers.dev/docs</code></p>
        </div>
        <div class="info-box">
            <h4>🔧 Key Technologies</h4>
            <ul style="margin-left: 20px; color: #4b5563;">
                <li>Solana Blockchain (Devnet)</li>
                <li>Metaplex MPL Core NFTs</li>
                <li>Cloudflare Workers + Hono</li>
                <li>Prisma + Neon PostgreSQL</li>
                <li>Cloudflare R2 Storage</li>
            </ul>
        </div>
    </div>

    <div class="info-box">
        <h4>📊 API Statistics</h4>
        <table>
            <tr><td>Total Endpoints</td><td><strong>53</strong></td></tr>
            <tr><td>NFT Operations</td><td>Mint, Transfer, List, Buy, Cancel</td></tr>
            <tr><td>Event System</td><td>Create, Join, Rewards</td></tr>
            <tr><td>Payment Integration</td><td>Coinbase Commerce</td></tr>
        </table>
    </div>

    <h2 id="architecture">2. System Architecture</h2>
    
    <h3>2.1 High-Level Architecture</h3>
    <div class="diagram">┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React + Vite)                        │
│                         Cloudflare Workers (frontend.ansht.workers.dev)     │
├─────────────────────────────────────────────────────────────────────────────┤
│  Components:                                                                │
│  ├── MarketplaceList    - Browse & buy NFTs                                 │
│  ├── UserNftList        - View owned NFTs, list for sale                    │
│  ├── NftCreator         - Mint new NFTs                                     │
│  ├── AlbumPage          - Music album display with track player             │
│  ├── EventsPage         - Event badges & participation                      │
│  └── RewardSystem       - Loyalty rewards                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTPS
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BACKEND (Cloudflare Workers + Hono)                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   mint.ts   │  │  escrow.ts  │  │  album.ts   │  │  upload.ts  │         │
│  │  NFT Mint   │  │ List/Buy    │  │ Music NFT   │  │  R2 Storage │         │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  event.ts   │  │  reward.ts  │  │  dispute.ts │  │ payment.ts  │         │
│  │ Event Mgmt  │  │ Loyalty     │  │ Disputes    │  │ Coinbase    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘
          │                    │                         │
          ▼                    ▼                         ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────────┐
│   PostgreSQL    │  │  Cloudflare R2  │  │        Solana Devnet            │
│   (Neon)        │  │  (nftimages)    │  │  Escrow: 3ozh4TQJbeyXFUu...     │
│                 │  │  /images/       │  │  MPL Core: CoREENxT6tW1...      │
└─────────────────┘  └─────────────────┘  └─────────────────────────────────┘</div>

    <h2 id="authentication">3. Authentication</h2>
    
    <h3>3.1 Admin API Key</h3>
    <p>Admin-protected endpoints require the <code>X-Admin-API-Key</code> header.</p>
    
    <div class="info-box warning">
        <h4>🔑 Admin API Key for Testing</h4>
        <p>Use this key for all admin endpoints:</p>
        <pre><code>X-Admin-API-Key: anshtyagi</code></pre>
    </div>

    <h4>How to set in Swagger UI:</h4>
    <ol style="margin-left: 20px; color: #4b5563;">
        <li>Go to <code>https://kumele-backend.ansht.workers.dev/docs</code></li>
        <li>Click the <strong>"Authorize"</strong> button (🔓)</li>
        <li>Enter: <code>anshtyagi</code></li>
        <li>Click "Authorize" to save</li>
    </ol>

    <h3>3.2 Wallet Authentication</h3>
    <p>Endpoints that modify NFTs require wallet signatures. The API returns unsigned transactions that must be signed by the user's Phantom wallet.</p>

    <div class="info-box">
        <h4>📱 Test Wallet Address</h4>
        <p>Pre-configured for testing:</p>
        <pre><code>anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm</code></pre>
    </div>

    <h2 id="base-url">4. Base URL & Setup</h2>
    
    <table>
        <tr><th>Environment</th><th>Base URL</th></tr>
        <tr><td>Production</td><td><code>https://kumele-backend.ansht.workers.dev</code></td></tr>
        <tr><td>Local Development</td><td><code>http://localhost:8787</code></td></tr>
    </table>

    <h3>4.1 Pre-configured Test Data</h3>
    <table>
        <tr><th>Resource</th><th>Test Value</th></tr>
        <tr><td>Test Wallet</td><td><code>anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm</code></td></tr>
        <tr><td>Test NFT Asset</td><td><code>F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F</code></td></tr>
        <tr><td>Test Event ID</td><td><code>4eaf98ff-950c-4bdb-aced-9351cf358527</code></td></tr>
        <tr><td>Test Escrow PDA</td><td><code>Y7WCkB2ga7LGGpYdgL6HkSDccSAw5sFdkgzVsdBBgD1</code></td></tr>
        <tr><td>Test Dispute ID</td><td><code>38d9ad88-7e45-4bc2-9754-2b5f4ac85248</code></td></tr>
    </table>

    <h2 id="endpoints">5. API Endpoints</h2>

    <h3>5.1 System Endpoints</h3>
    <table>
        <tr><th>Method</th><th>Endpoint</th><th>Description</th></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/health</code></td><td>Health check - returns API status</td></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/test</code></td><td>Simple test endpoint</td></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/debug/db</code></td><td>Database connection stats</td></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/docs</code></td><td>Swagger UI documentation</td></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/api-docs</code></td><td>Full documentation (this page)</td></tr>
    </table>

    <h3>5.2 NFT Endpoints</h3>
    <table>
        <tr><th>Method</th><th>Endpoint</th><th>Description</th></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/?asset={assetId}</code></td><td>Search NFT by asset public key</td></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/owner?owner={wallet}</code></td><td>Get all NFTs owned by a wallet</td></tr>
        <tr><td><span class="method post">POST</span></td><td><code>/mint</code></td><td>Mint a new NFT (returns unsigned tx)</td></tr>
        <tr><td><span class="method post">POST</span></td><td><code>/transfer</code></td><td>Transfer NFT to another wallet</td></tr>
    </table>

    <h3>5.3 Marketplace Endpoints</h3>
    <table>
        <tr><th>Method</th><th>Endpoint</th><th>Description</th></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/listings</code></td><td>Get all active marketplace listings</td></tr>
        <tr><td><span class="method post">POST</span></td><td><code>/list</code></td><td>List NFT for sale (creates escrow)</td></tr>
        <tr><td><span class="method post">POST</span></td><td><code>/buy</code></td><td>Buy a listed NFT</td></tr>
        <tr><td><span class="method post">POST</span></td><td><code>/cancel</code></td><td>Cancel listing and return NFT</td></tr>
    </table>

    <h3>5.4 Event Endpoints</h3>
    <table>
        <tr><th>Method</th><th>Endpoint</th><th>Description</th></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/api/events</code></td><td>List all events</td></tr>
        <tr><td><span class="method post">POST</span></td><td><code>/api/events</code></td><td>Create new event</td></tr>
        <tr><td><span class="method post">POST</span></td><td><code>/api/events/{id}/join</code></td><td>Join an event</td></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/api/events/{id}/progress</code></td><td>Get user progress in event</td></tr>
        <tr><td><span class="method delete">DELETE</span></td><td><code>/api/events/{id}</code></td><td>Delete event (Admin only)</td></tr>
    </table>

    <h3>5.5 Payment Endpoints</h3>
    <table>
        <tr><th>Method</th><th>Endpoint</th><th>Description</th></tr>
        <tr><td><span class="method post">POST</span></td><td><code>/api/payment/create</code></td><td>Create Coinbase Commerce charge</td></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/api/payment/status/{id}</code></td><td>Get payment status</td></tr>
        <tr><td><span class="method post">POST</span></td><td><code>/api/payment/cancel/{id}</code></td><td>Cancel payment</td></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/api/payments/logs</code></td><td>Get payment logs</td></tr>
    </table>

    <h3>5.6 Dispute Endpoints</h3>
    <table>
        <tr><th>Method</th><th>Endpoint</th><th>Description</th></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/api/disputes</code></td><td>List all disputes</td></tr>
        <tr><td><span class="method post">POST</span></td><td><code>/api/disputes</code></td><td>Create new dispute</td></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/api/disputes/{id}</code></td><td>Get dispute details</td></tr>
        <tr><td><span class="method post">POST</span></td><td><code>/api/disputes/{id}/resolve</code></td><td>Resolve dispute</td></tr>
    </table>

    <h3>5.7 Reward Endpoints</h3>
    <table>
        <tr><th>Method</th><th>Endpoint</th><th>Description</th></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/api/rewards/account</code></td><td>Get user's reward account</td></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/api/rewards/available</code></td><td>List available rewards</td></tr>
        <tr><td><span class="method post">POST</span></td><td><code>/api/rewards/interaction</code></td><td>Record interaction (earn points)</td></tr>
        <tr><td><span class="method post">POST</span></td><td><code>/api/rewards/claim</code></td><td>Claim NFT reward</td></tr>
    </table>

    <h3>5.8 Album Endpoints</h3>
    <table>
        <tr><th>Method</th><th>Endpoint</th><th>Description</th></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/api/albums</code></td><td>List all albums</td></tr>
        <tr><td><span class="method post">POST</span></td><td><code>/api/albums</code></td><td>Create new album</td></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/api/albums/{id}</code></td><td>Get album with tracks</td></tr>
    </table>

    <h3>5.9 Admin Endpoints (Requires X-Admin-API-Key)</h3>
    <table>
        <tr><th>Method</th><th>Endpoint</th><th>Description</th></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/api/admin/dashboard</code></td><td>Full admin dashboard data</td></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/api/admin/rewards</code></td><td>Admin reward management</td></tr>
        <tr><td><span class="method get">GET</span></td><td><code>/api/admin/claims</code></td><td>Get all reward claims</td></tr>
        <tr><td><span class="method post">POST</span></td><td><code>/api/escrow/admin_resolve</code></td><td>Admin resolve escrow dispute</td></tr>
    </table>

    <h2 id="testing">6. Testing Guide</h2>

    <h3>6.1 Using Swagger UI (Recommended)</h3>
    <ol style="margin-left: 20px; color: #4b5563;">
        <li>Open <a href="/docs">/docs</a></li>
        <li>Click "Authorize" and enter: <code>anshtyagi</code></li>
        <li>Find an endpoint and click "Try it out"</li>
        <li>Fields are pre-filled with test data - just click "Execute"</li>
    </ol>

    <h3>6.2 Using cURL</h3>
    
    <h4>Health Check</h4>
    <pre><code>curl https://kumele-backend.ansht.workers.dev/health</code></pre>

    <h4>Get NFTs by Owner</h4>
    <pre><code>curl "https://kumele-backend.ansht.workers.dev/owner?owner=anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm"</code></pre>

    <h4>Admin Dashboard (with auth)</h4>
    <pre><code>curl -H "X-Admin-API-Key: anshtyagi" https://kumele-backend.ansht.workers.dev/api/admin/dashboard</code></pre>

    <h4>Mint NFT</h4>
    <pre><code>curl -X POST https://kumele-backend.ansht.workers.dev/mint \\
  -H "Content-Type: application/json" \\
  -d '{"uri": "https://gateway.irys.xyz/...", "name": "Test NFT", "owner": "anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm"}'</code></pre>

    <h2 id="examples">7. Request/Response Examples</h2>

    <h3>7.1 Mint NFT</h3>
    <div class="endpoint">
        <div class="endpoint-header">
            <span class="method post">POST</span>
            <span class="endpoint-path">/mint</span>
        </div>
        <h4>Request Body:</h4>
        <pre><code>{
  "uri": "https://gateway.irys.xyz/4JFR7e2bfWE8QyPvRhnrTer7RuLpVvwty2vesQrPa9iK",
  "name": "My Cool NFT",
  "owner": "anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm"
}</code></pre>
        <h4>Response (200 OK):</h4>
        <pre><code>{
  "transaction": "AQAAAAAAAAAAAAAAAAAAAAo...",
  "mint": "7KjMvebu5ZLaVh5rv6as7tvFYq1AEUDVGEzA71UVf9MM"
}</code></pre>
    </div>

    <h3>7.2 List NFT for Sale</h3>
    <div class="endpoint">
        <div class="endpoint-header">
            <span class="method post">POST</span>
            <span class="endpoint-path">/list</span>
        </div>
        <h4>Request Body:</h4>
        <pre><code>{
  "assetId": "F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F",
  "price": 1.5,
  "seller": "anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm"
}</code></pre>
    </div>

    <h2 id="errors">8. Error Handling</h2>

    <h3>8.1 HTTP Status Codes</h3>
    <table>
        <tr><th>Code</th><th>Meaning</th><th>Description</th></tr>
        <tr><td><span class="status-badge success">200</span></td><td>OK</td><td>Request successful</td></tr>
        <tr><td><span class="status-badge error">400</span></td><td>Bad Request</td><td>Missing or invalid parameters</td></tr>
        <tr><td><span class="status-badge error">401</span></td><td>Unauthorized</td><td>Invalid or missing API key</td></tr>
        <tr><td><span class="status-badge error">404</span></td><td>Not Found</td><td>Resource not found</td></tr>
        <tr><td><span class="status-badge error">409</span></td><td>Conflict</td><td>Duplicate mint attempt</td></tr>
        <tr><td><span class="status-badge error">500</span></td><td>Server Error</td><td>Internal error</td></tr>
    </table>

    <h3>8.2 Error Response Format</h3>
    <pre><code>{"error": "Error message", "details": "Additional context"}</code></pre>

    <h2 id="flows">9. Flow Diagrams</h2>

    <h3>9.1 NFT Minting Flow</h3>
    <div class="diagram">User                    Frontend                  Backend                 Solana
 │ Upload Image            │                         │                      │
 ├────────────────────────►│ POST /api/upload/image  │                      │
 │                         ├────────────────────────►│──► R2 Storage        │
 │                         │◄────────────────────────┤   imageUrl           │
 │                         │ POST /mint              │                      │
 │                         ├────────────────────────►│ Build transaction    │
 │                         │◄────────────────────────┤ { transaction }      │
 │     Sign Transaction    │                         │                      │
 │◄────────────────────────┤                         │                      │
 │ Wallet Signature        │                         │                      │
 ├────────────────────────►│───────────────────────────────────────────────►│
 │     Success!            │◄───────────────────────────────────────────────┤</div>

    <h3>9.2 Marketplace (Buy) Flow</h3>
    <div class="diagram">Buyer                   Frontend                  Backend                 Solana
 │ Buy NFT                 │                         │                      │
 ├────────────────────────►│ POST /buy               │                      │
 │                         ├────────────────────────►│ Build buy tx         │
 │                         │◄────────────────────────┤ { transaction }      │
 │     Sign                │                         │                      │
 ├────────────────────────►│───────────────────────────────────────────────►│
 │                         │                         │  SOL → Seller        │
 │     Purchased!          │◄───────────────────────────────────────────────┤</div>

    <h2 id="security">10. Security Features</h2>

    <div class="info-box">
        <h4>🔒 Security Measures</h4>
        <ul style="margin-left: 20px; color: #4b5563;">
            <li><strong>Transaction Integrity:</strong> SHA-256 checksums for verification</li>
            <li><strong>Duplicate Prevention:</strong> Checks existing NFTs before minting</li>
            <li><strong>Admin Authentication:</strong> X-Admin-API-Key header required</li>
            <li><strong>Security Logging:</strong> All sensitive events logged</li>
            <li><strong>CORS:</strong> Trusted origins only</li>
        </ul>
    </div>

    <hr style="margin: 40px 0; border: none; border-top: 1px solid #e5e7eb;">

    <h2>Quick Reference Card</h2>
    <div class="grid-2">
        <div class="info-box success">
            <h4>🌐 Base URL</h4>
            <code>https://kumele-backend.ansht.workers.dev</code>
        </div>
        <div class="info-box warning">
            <h4>🔑 Admin Key</h4>
            <code>X-Admin-API-Key: anshtyagi</code>
        </div>
    </div>
    <div class="info-box">
        <h4>📋 Test Values</h4>
        <table>
            <tr><td>Wallet</td><td><code>anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm</code></td></tr>
            <tr><td>NFT Asset</td><td><code>F1SgES56ivWjetkpx6ysaTGXbkx8HLdrCrUqe2zBmf2F</code></td></tr>
            <tr><td>Event ID</td><td><code>4eaf98ff-950c-4bdb-aced-9351cf358527</code></td></tr>
            <tr><td>Escrow PDA</td><td><code>Y7WCkB2ga7LGGpYdgL6HkSDccSAw5sFdkgzVsdBBgD1</code></td></tr>
        </table>
    </div>

    <footer>
        <p><strong>Kumule NFT Marketplace API</strong></p>
        <p>Version 1.0.0 | Documentation generated January 2026</p>
        <p>Live API: <a href="/docs">/docs</a> | <a href="/openapi.json">/openapi.json</a></p>
    </footer>
</body>
</html>`;
  return c.html(html);
})

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
  const corsHeaders: Record<string, string> = {}
  
  if (origin) {
    corsHeaders['Access-Control-Allow-Origin'] = origin
    corsHeaders['Access-Control-Allow-Credentials'] = 'true'
  } else {
    corsHeaders['Access-Control-Allow-Origin'] = '*'
  }
  corsHeaders['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
  corsHeaders['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Admin-API-Key'
  
  // Set headers for all responses
  Object.entries(corsHeaders).forEach(([key, value]) => {
    c.header(key, value)
  })
  
  if (c.req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders
    })
  }
  
  await next()
})

// Event endpoints (moved after CORS middleware)
app.post('/api/events', createEvent)
app.get('/api/events', listEvents)
app.post('/api/events/:id/join', joinEvent)
app.delete('/api/events/:id', adminAuth, deleteEvent)
app.get('/api/events/:id/rewards/status', getEventRewardStatus)
app.post('/api/events/:id/rewards/retry', adminAuth, retryEventRewardMinting)

// Event rewards & progress routes
import { getEventProgress, addEventPoints, claimEventReward, updateEventRewardConfig, getEventRewardClaims } from './event-rewards'
app.get('/api/events/:id/progress', getEventProgress)
app.post('/api/events/:id/progress/add-points', addEventPoints)
app.post('/api/events/:id/rewards/:rewardId/claim', claimEventReward)
app.put('/api/admin/events/:id/reward-config', adminAuth, updateEventRewardConfig)
app.get('/api/admin/events/:id/claims', adminAuth, getEventRewardClaims)
app.get('/api/admin/claims', adminAuth, getEventRewardClaims)

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

// R2 Upload routes (for admin reward NFT minting and marketplace)
import { uploadImageToR2, uploadFilesToR2, uploadMetadataToR2, serveImageFromR2, serveMetadataFromR2, uploadAudioToR2, serveAudioFromR2 } from './upload'
app.post('/api/upload/image', uploadImageToR2) // Public (no auth needed for marketplace)
app.post('/api/upload/files', uploadFilesToR2) // Public (for main + cover files)
app.post('/api/upload/metadata', uploadMetadataToR2) // Public (no auth needed for marketplace)
app.post('/api/upload/audio', uploadAudioToR2) // Public (for music album tracks)
app.get('/cdn/images/:filename', serveImageFromR2)
app.get('/cdn/metadata/:filename', serveMetadataFromR2)
app.get('/cdn/audio/:filename', serveAudioFromR2) // Audio streaming with range support

// Album routes (for music NFT albums)
import { createAlbum, listAlbums, getAlbum, updateAlbum, deleteAlbum, addTrack, updateTrack, deleteTrack, generateTrackMetadata } from './album'
app.post('/api/albums', createAlbum)
app.get('/api/albums', listAlbums)
app.get('/api/albums/:id', getAlbum)
app.put('/api/albums/:id', updateAlbum)
app.delete('/api/albums/:id', deleteAlbum)
app.post('/api/albums/:id/tracks', addTrack)
app.put('/api/albums/:id/tracks/:trackId', updateTrack)
app.delete('/api/albums/:id/tracks/:trackId', deleteTrack)
app.get('/api/albums/:id/tracks/:trackId/metadata', generateTrackMetadata)

// Audit routes (transaction checksum verification)
import { verifyTransactionChecksum, logSecurityEvent } from './audit'
app.get('/api/audit/verify/:transactionId', async (c) => {
  const { transactionId } = c.req.param()
  const connectionString = getConnectionString(c.env)
  if (!connectionString) {
    return c.json({ valid: false, message: 'Database not configured' }, 500)
  }
  const result = await verifyTransactionChecksum(connectionString, transactionId)
  return c.json(result, result.valid ? 200 : 400)
})

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

// ==================== COMPATIBILITY v1 ENDPOINTS ====================
// Mobile/API v1 compatibility layer for Flutter and other clients

app.get('/api/v1/subscriptions/tiers', (c) => {
  return c.json({
    data: [
      { id: 'free', name: 'Free', description: 'Explore Kumule basics', price: 0, currency: 'USD', interval: 'month', features: ['Browse marketplace', 'Basic event access'] },
      { id: 'pro', name: 'Pro', description: 'For active creators and collectors', price: 9.99, currency: 'USD', interval: 'month', features: ['Priority drops', 'Advanced analytics', 'Creator rewards boost'] },
      { id: 'premium', name: 'Premium', description: 'Full access for power users', price: 29.99, currency: 'USD', interval: 'month', features: ['VIP support', 'Premium events', 'Early access to launches'] }
    ],
    count: 3
  })
})

app.get('/api/v1/app/config', (c) => {
  return c.json({
    app: {
      name: 'Kumule NFT Marketplace',
      version: '1.0.0',
      environment: 'development',
      api_base_url: 'https://kumele-backend.ansht.workers.dev'
    },
    feature_flags: {
      web3_enabled: true,
      subscriptions_enabled: true,
      marketplace_enabled: true,
      rewards_enabled: true
    },
    wallet: {
      network: 'devnet',
      provider: 'phantom',
      requires_signature: true
    }
  })
})

app.get('/api/v1/hobbies/categories', (c) => {
  return c.json({
    data: [
      { id: 'music', name: 'Music', icon: 'music_note' },
      { id: 'gaming', name: 'Gaming', icon: 'sports_esports' },
      { id: 'sports', name: 'Sports', icon: 'sports_soccer' },
      { id: 'collectibles', name: 'Collectibles', icon: 'diamond' },
      { id: 'art', name: 'Art', icon: 'palette' },
      { id: 'tech', name: 'Tech', icon: 'memory' }
    ],
    count: 6
  })
})

app.get('/api/v1/localization/strings', (c) => {
  return c.json({
    lang: 'en',
    namespace: 'ui',
    strings: {
      app_title: 'Kumule',
      marketplace_title: 'Marketplace',
      rewards_title: 'Rewards',
      connect_wallet: 'Connect Wallet',
      buy_now: 'Buy Now',
      claim_nft: 'Claim NFT',
      subscriptions_title: 'Subscriptions',
      loading: 'Loading',
      retry: 'Retry',
      cancel: 'Cancel'
    },
    count: 10
  })
})

app.get('/api/v1/nfts/marketplace', async (c) => {
  try {
    const res = await getListings(c)
    const body = await res.json() as { listings?: any[] }
    const listings = body.listings || []
    return c.json({ data: listings, count: listings.length })
  } catch (error) {
    console.error('v1 marketplace error:', error)
    return c.json({ data: [], count: 0 })
  }
})

app.get('/api/v1/payments/history', async (c) => {
  const walletAddress = c.req.query('walletAddress')
  if (!walletAddress) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  try {
    const connectionString = getConnectionString(c.env)
    if (!connectionString) {
      return c.json({ data: [], count: 0 })
    }
    const result = await withPrisma(connectionString, async (prisma) => {
      const transactions = await prisma.transaction.findMany({
        where: { walletAddress },
        orderBy: { createdAt: 'desc' },
        take: 50
      })
      return transactions
    })
    return c.json({ data: result, count: result.length })
  } catch (error) {
    console.error('v1 payments history error:', error)
    return c.json({ data: [], count: 0 })
  }
})

export default app

