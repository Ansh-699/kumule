# Webhook System - Demo Guide

## 

Your NFT Marketplace uses **webhooks** to automatically process payments and update transaction statuses in real-time. This guide explains how webhooks work and how to demonstrate them to clients.

## 🔄 How Webhooks Work

### 1. **Payment Flow with Webhooks**

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Client    │────────▶   Your API   │────────▶ Coinbase   │
│  (Frontend) │         │   (Backend)  │         │  Commerce   │
└─────────────┘         └──────────────┘         └─────────────┘
                              │                          │
                              │                          │
                              ▼                          │
                        ┌──────────────┐                 │
                        │   Database   │                 │
                        │  (Pending)   │                 │
                        └──────────────┘                 │
                              │                          │
                              │                          │
                              │                          ▼
                              │                    ┌─────────────┐
                              │                    │   Payment   │
                              │                    │  Processor  │
                              │                    └─────────────┘
                              │                         │
                              │                         │
                              │         ┌───────────────┘
                              │         │
                              │         ▼
                              │    ┌──────────────┐
                              │    │   Webhook    │
                              │    │   (POST)     │
                              │    └──────────────┘
                              │         │
                              ▼         ▼
                        ┌──────────────────────┐
                        │   Database Updated   │
                        │   (COMPLETED)        │
                        └──────────────────────┘
```

### 2. **Two Types of Webhooks**

#### **A. Coinbase Commerce Webhooks** (Crypto Payments)
- **Endpoint**: `POST /api/webhooks/coinbase`
- **Trigger**: When a user pays via Coinbase Commerce
- **Events**: `charge:created`, `charge:confirmed`, `charge:failed`, etc.
- **What it does**:
  1. Verifies webhook signature (security)
  2. Logs payment event to `payment_logs` table
  3. Updates transaction status in `transactions` table
  4. Extracts wallet address, transaction hash, amount

#### **B. Solana Payment Webhooks** (Direct SOL Payments)
- **Endpoint**: `POST /api/payments/webhook`
- **Trigger**: When a user pays directly with SOL
- **What it does**:
  1. Verifies transaction on Solana blockchain
  2. Logs payment event
  3. Updates transaction status
  4. Links payment to user wallet

## 🎯 Demo Mode - How to Show Clients

### **Demo Scenario 1: Simulate Coinbase Webhook**

```bash
# 1. Create a payment charge (this creates a pending transaction)
curl -X POST http://localhost:8787/api/payment/create \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 10,
    "currency": "USD",
    "walletAddress": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
  }'

# Response will include a chargeId like: "demo_charge_1234567890_abc123"

# 2. Simulate webhook notification (when payment is confirmed)
curl -X POST http://localhost:8787/api/webhooks/coinbase \
  -H "Content-Type: application/json" \
  -H "X-CC-Webhook-Signature: demo_signature" \
  -d '{
    "event": {
      "type": "charge:confirmed",
      "data": {
        "id": "demo_charge_1234567890_abc123",
        "code": "ABC123",
        "pricing": {
          "local": {
            "amount": "10.00",
            "currency": "USD"
          }
        },
        "payments": [{
          "transaction_id": "0x1234567890abcdef",
          "payer_addresses": ["9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"],
          "value": {
            "currency": "USDC"
          },
          "network": "ethereum"
        }]
      }
    }
  }'

# 3. Check transaction status (should now be COMPLETED)
curl http://localhost:8787/api/payment/status/demo_charge_1234567890_abc123
```

### **Demo Scenario 2: Simulate Solana Payment Webhook**

```bash
# Simulate a direct SOL payment notification
curl -X POST http://localhost:8787/api/payments/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "solanaSignature": "5j7s8K9mN2pQ4rS6tU8vW0xY2zA4bC6dE8fG0hJ2kL4mN6pQ8rS0tU2vW4xY6z",
    "walletAddress": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    "amount": 1.5,
    "chargeId": "sol_payment_123",
    "transactionType": "PAYMENT"
  }'
```

### **Demo Scenario 3: View Webhook Logs**

```bash
# View all payment logs (webhook events)
curl "http://localhost:8787/api/payments/logs?limit=10"

# View logs for specific charge
curl "http://localhost:8787/api/payments/logs?chargeId=demo_charge_1234567890_abc123"

# View transaction history
curl "http://localhost:8787/api/payments/transactions?limit=20"
```

## 📊 What Happens Behind the Scenes

### **Step-by-Step Process:**

1. **User Initiates Payment**
   - Frontend calls `/api/payment/create`
   - Backend creates a charge (or demo charge)
   - Transaction record created with status: `PENDING`

2. **User Completes Payment**
   - User pays via Coinbase Commerce or sends SOL
   - Payment processor (Coinbase/Solana) processes payment

3. **Webhook Notification**
   - Payment processor sends POST request to your webhook endpoint
   - Your backend receives the webhook
   - Verifies signature (for Coinbase) or transaction (for Solana)

4. **Database Update**
   - Payment event logged to `payment_logs` table
   - Transaction status updated: `PENDING` → `COMPLETED`
   - Wallet address, transaction hash, amount stored

5. **Frontend Updates**
   - Frontend polls `/api/payment/status/:id`
   - Sees status changed to `COMPLETED`
   - Shows success message to user

## 🔐 Security Features

1. **Signature Verification** (Coinbase)
   - Uses HMAC-SHA256 to verify webhook authenticity
   - Prevents fake webhook attacks
   - Configured via `COINBASE_WEBHOOK_SECRET`

2. **Transaction Verification** (Solana)
   - Verifies transaction exists on blockchain
   - Checks transaction success status
   - Uses Solana RPC to validate

3. **Idempotency**
   - Same webhook can be processed multiple times safely
   - Updates existing records instead of creating duplicates

## 🎬 Live Demo Script

### **For Client Presentation:**

1. **Show Current State**
   ```bash
   # Show empty/initial state
   curl "http://localhost:8787/api/payments/transactions?limit=5"
   ```

2. **Create Payment**
   ```bash
   # Create a payment charge
   curl -X POST http://localhost:8787/api/payment/create \
     -H "Content-Type: application/json" \
     -d '{"amount": 25, "currency": "USD"}'
   ```

3. **Show Pending Transaction**
   ```bash
   # Check status - should be PENDING
   curl "http://localhost:8787/api/payment/status/{chargeId}"
   ```

4. **Simulate Webhook** (The Magic Moment!)
   ```bash
   # Send webhook - watch status change in real-time
   curl -X POST http://localhost:8787/api/webhooks/coinbase \
     -H "Content-Type: application/json" \
     -d '{...webhook payload...}'
   ```

5. **Show Updated Status**
   ```bash
   # Check status again - now COMPLETED!
   curl "http://localhost:8787/api/payment/status/{chargeId}"
   ```

6. **View Audit Trail**
   ```bash
   # Show webhook logs
   curl "http://localhost:8787/api/payments/logs?chargeId={chargeId}"
   ```

## 📝 Key Points to Explain to Clients

1. **Real-Time Updates**: Webhooks provide instant updates without polling
2. **Reliability**: Payment processor guarantees webhook delivery
3. **Audit Trail**: All webhook events are logged for compliance
4. **Security**: Signature verification ensures authenticity
5. **Scalability**: Handles high volume of payments automatically
6. **Multi-Chain**: Supports both Coinbase Commerce and direct Solana payments

## 🛠️ Production Setup

1. **Configure Webhook URL in Coinbase Commerce Dashboard**
   - Go to: https://commerce.coinbase.com/dashboard/settings
   - Set webhook URL: `https://your-domain.com/api/webhooks/coinbase`
   - Copy webhook secret to `.dev.vars` as `COINBASE_WEBHOOK_SECRET`

2. **Set Up Solana RPC**
   - Configure `SOLANA_RPC_URL` in environment variables
   - Use Helius, QuickNode, or public RPC endpoint

3. **Monitor Webhooks**
   - Check `/api/payments/logs` endpoint regularly
   - Set up alerts for failed webhooks
   - Monitor transaction status updates

## 🐛 Troubleshooting

- **Webhook not received?** Check Coinbase dashboard webhook settings
- **Signature verification failing?** Verify `COINBASE_WEBHOOK_SECRET` matches
- **Transaction not updating?** Check database connection and logs
- **Solana verification failing?** Verify RPC URL and transaction signature

## 📚 API Endpoints Reference

- `POST /api/payment/create` - Create payment charge
- `GET /api/payment/status/:id` - Check payment status
- `POST /api/webhooks/coinbase` - Coinbase webhook endpoint
- `POST /api/payments/webhook` - Unified webhook endpoint
- `GET /api/payments/logs` - View webhook logs
- `GET /api/payments/transactions` - View transaction history

