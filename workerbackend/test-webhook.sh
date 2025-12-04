#!/bin/bash

# Test webhook endpoints
# Make sure your worker is running: bun run dev

BASE_URL="${1:-http://localhost:8787}"

echo "Testing webhook endpoints at: $BASE_URL"
echo "======================================="

# Test 1: Simulate Coinbase charge:created webhook
echo ""
echo "1. Testing Coinbase charge:created webhook..."
curl -s -X POST "$BASE_URL/api/payments/webhook" \
  -H "Content-Type: application/json" \
  -H "X-CC-Webhook-Signature: test-signature" \
  -d '{
    "event": {
      "type": "charge:created",
      "data": {
        "id": "test_charge_001",
        "code": "TESTCODE",
        "pricing": {
          "local": { "amount": "10.00", "currency": "USD" }
        },
        "payments": []
      }
    }
  }' | jq .

# Test 2: Simulate Coinbase charge:confirmed webhook
echo ""
echo "2. Testing Coinbase charge:confirmed webhook..."
curl -s -X POST "$BASE_URL/api/payments/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "event": {
      "type": "charge:confirmed",
      "data": {
        "id": "test_charge_001",
        "code": "TESTCODE",
        "pricing": {
          "local": { "amount": "10.00", "currency": "USD" }
        },
        "payments": [
          {
            "payer_addresses": ["0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"],
            "transaction_id": "0xabc123def456789...",
            "network": "ethereum",
            "value": { "currency": "ETH" }
          }
        ]
      }
    }
  }' | jq .

# Test 3: Simulate Solana payment notification
echo ""
echo "3. Testing Solana payment webhook..."
curl -s -X POST "$BASE_URL/api/payments/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "solanaSignature": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9g9k4PPc9iYB3KXbBqBcD2C4gWNDm3QoTQ",
    "walletAddress": "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV",
    "amount": 0.1,
    "transactionType": "PAYMENT"
  }' | jq .

# Test 4: Get payment logs
echo ""
echo "4. Testing payment logs endpoint..."
curl -s "$BASE_URL/api/payments/logs?limit=5" | jq .

# Test 5: Get transaction history
echo ""
echo "5. Testing transaction history endpoint..."
curl -s "$BASE_URL/api/payments/transactions?limit=5" | jq .

# Test 6: Create a payment and verify it shows up
echo ""
echo "6. Creating a test payment..."
CHARGE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/payment/create" \
  -H "Content-Type: application/json" \
  -d '{"amount": 5.00, "currency": "USD", "walletAddress": "TestWallet123"}')
echo "$CHARGE_RESPONSE" | jq .

CHARGE_ID=$(echo "$CHARGE_RESPONSE" | jq -r '.chargeId')
echo ""
echo "7. Verifying payment with chargeId: $CHARGE_ID"
curl -s "$BASE_URL/api/payment/status/$CHARGE_ID" | jq .

echo ""
echo "8. Checking if transaction was logged..."
curl -s "$BASE_URL/api/payments/transactions?limit=1" | jq '.transactions[0]'

echo ""
echo "======================================="
echo "Tests complete!"

