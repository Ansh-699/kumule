# Webhook Flow Diagram - Visual Explanation

## 🔄 Complete Payment Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER PAYMENT JOURNEY                         │
└─────────────────────────────────────────────────────────────────┘

1. USER INITIATES PAYMENT
   ┌─────────────┐
   │   Frontend  │
   │  (Browser)  │
   └──────┬──────┘
          │ POST /api/payment/create
          │ { amount: 50, currency: "USD" }
          ▼
   ┌──────────────┐
   │   Backend    │──────────┐
   │  (Worker)    │          │ Creates charge
   └──────┬───────┘          │ via Coinbase API
          │                  │ (or demo mode)
          │ Returns chargeId │
          ▼                  │
   ┌──────────────┐          │
   │   Database   │◄─────────┘
   │ Transaction  │
   │ Status: PENDING │
   └──────────────┘
          │
          │ User redirected to payment page
          ▼
   ┌──────────────┐
   │   Coinbase   │
   │  Commerce    │
   │  Checkout    │
   └──────┬───────┘
          │
          │ User completes payment
          │
          ▼
   ┌──────────────┐
   │   Payment    │
   │  Processor   │
   │  (Coinbase)  │
   └──────┬───────┘
          │
          │ ⚡ WEBHOOK TRIGGERED ⚡
          │ POST /api/webhooks/coinbase
          │
          ▼
   ┌─────────────────────────────────────┐
   │      YOUR WEBHOOK ENDPOINT           │
   │  ┌───────────────────────────────┐   │
   │  │ 1. Verify Signature (HMAC)    │   │
   │  │ 2. Parse Event Type           │   │
   │  │ 3. Extract Payment Details    │   │
   │  │ 4. Update Database            │   │
   │  └───────────────────────────────┘   │
   └──────────────┬──────────────────────┘
                  │
                  ▼
   ┌──────────────────────────────┐
   │      DATABASE UPDATES        │
   │  ┌────────────────────────┐  │
   │  │ payment_logs table     │  │
   │  │ - Event logged         │  │
   │  │ - Signature verified   │  │
   │  │ - Raw payload stored   │  │
   │  └────────────────────────┘  │
   │  ┌────────────────────────┐  │
   │  │ transactions table     │  │
   │  │ - Status: COMPLETED    │  │
   │  │ - Wallet address saved │  │
   │  │ - TX hash saved        │  │
   │  │ - Amount confirmed     │  │
   │  └────────────────────────┘  │
   └──────────────────────────────┘
                  │
                  │ Frontend polls status
                  ▼
   ┌──────────────┐
   │   Frontend   │
   │  Shows:      │
   │  ✅ Payment  │
   │  Confirmed!  │
   └──────────────┘
```

## 📊 Webhook Event Types

### Coinbase Commerce Events:

| Event Type | Status | Description |
|------------|--------|-------------|
| `charge:created` | PENDING | Charge created, awaiting payment |
| `charge:pending` | PENDING | Payment initiated but not confirmed |
| `charge:confirmed` | COMPLETED | Payment confirmed on blockchain |
| `charge:failed` | FAILED | Payment failed |
| `charge:expired` | EXPIRED | Payment window expired |
| `charge:canceled` | CANCELED | Payment canceled by user |

### Solana Payment Events:

| Event Type | Status | Description |
|------------|--------|-------------|
| `solana:payment` | COMPLETED | Direct SOL payment received |

## 🔐 Security Flow

```
┌─────────────────────────────────────────┐
│         WEBHOOK SECURITY                │
└─────────────────────────────────────────┘

Coinbase Webhook:
  ┌──────────────┐
  │  Coinbase   │
  │  Sends:     │
  │  - Payload  │
  │  - Signature│ (HMAC-SHA256)
  └──────┬──────┘
         │
         ▼
  ┌──────────────────┐
  │  Your Backend    │
  │  1. Receives     │
  │  2. Computes     │
  │     signature    │
  │  3. Compares     │
  │  4. Verifies ✅  │
  └──────────────────┘

Solana Webhook:
  ┌──────────────┐
  │  Frontend/   │
  │  RPC sends:  │
  │  - TX Hash   │
  │  - Signature │
  └──────┬───────┘
         │
         ▼
  ┌──────────────────┐
  │  Your Backend    │
  │  1. Receives     │
  │  2. Queries      │
  │     Solana RPC   │
  │  3. Verifies     │
  │     TX exists ✅ │
  └──────────────────┘
```

## 💾 Database Schema

```
payment_logs
├── eventType (charge:confirmed, etc.)
├── chargeId
├── walletAddress
├── txHash
├── amount
├── currency
├── status
├── verified (signature verified?)
└── rawPayload (full webhook JSON)

transactions
├── transactionId (chargeId)
├── status (PENDING → COMPLETED)
├── walletAddress
├── txHash
├── amount
├── currency
└── metadata (JSON)
```

## 🎯 Demo Points to Highlight

1. **Automatic Processing**: No manual intervention needed
2. **Real-Time Updates**: Status changes instantly
3. **Audit Trail**: Every event is logged
4. **Security**: Signature verification prevents fraud
5. **Reliability**: Handles retries and failures gracefully
6. **Multi-Chain**: Works with Coinbase and Solana

