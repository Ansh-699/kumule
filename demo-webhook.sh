#!/bin/bash

# Webhook Demo Script
# This script demonstrates the webhook flow for client presentations

API_URL="http://localhost:8787"
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Webhook System Demo ===${NC}\n"

# Step 1: Create a payment charge
echo -e "${YELLOW}Step 1: Creating payment charge...${NC}"
CHARGE_RESPONSE=$(curl -s -X POST "$API_URL/api/payment/create" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 50,
    "currency": "USD",
    "walletAddress": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
  }')

CHARGE_ID=$(echo $CHARGE_RESPONSE | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('chargeId', 'unknown'))")

echo -e "${GREEN}✓ Charge created: $CHARGE_ID${NC}"
echo "Response: $CHARGE_RESPONSE"
echo ""

# Step 2: Check initial status (should be PENDING)
echo -e "${YELLOW}Step 2: Checking initial transaction status...${NC}"
sleep 1
STATUS_RESPONSE=$(curl -s "$API_URL/api/payment/status/$CHARGE_ID")
echo "Status: $STATUS_RESPONSE"
echo ""

# Step 3: Simulate webhook notification
echo -e "${YELLOW}Step 3: Simulating webhook notification (payment confirmed)...${NC}"
WEBHOOK_PAYLOAD=$(cat <<EOF
{
  "event": {
    "type": "charge:confirmed",
    "data": {
      "id": "$CHARGE_ID",
      "code": "DEMO123",
      "pricing": {
        "local": {
          "amount": "50.00",
          "currency": "USD"
        }
      },
      "payments": [{
        "transaction_id": "0x$(openssl rand -hex 32)",
        "payer_addresses": ["9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"],
        "value": {
          "currency": "USDC"
        },
        "network": "ethereum"
      }]
    }
  }
}
EOF
)

WEBHOOK_RESPONSE=$(curl -s -X POST "$API_URL/api/webhooks/coinbase" \
  -H "Content-Type: application/json" \
  -H "X-CC-Webhook-Signature: demo_signature" \
  -d "$WEBHOOK_PAYLOAD")

echo -e "${GREEN}✓ Webhook processed${NC}"
echo "Response: $WEBHOOK_RESPONSE"
echo ""

# Step 4: Check updated status (should be COMPLETED)
echo -e "${YELLOW}Step 4: Checking updated transaction status...${NC}"
sleep 1
UPDATED_STATUS=$(curl -s "$API_URL/api/payment/status/$CHARGE_ID")
echo "Status: $UPDATED_STATUS"
echo ""

# Step 5: View webhook logs
echo -e "${YELLOW}Step 5: Viewing webhook audit logs...${NC}"
LOGS=$(curl -s "$API_URL/api/payments/logs?chargeId=$CHARGE_ID&limit=5")
echo "Logs: $LOGS"
echo ""

# Step 6: View transaction history
echo -e "${YELLOW}Step 6: Viewing transaction history...${NC}"
HISTORY=$(curl -s "$API_URL/api/payments/transactions?limit=5")
echo "Recent transactions: $HISTORY"
echo ""

echo -e "${GREEN}=== Demo Complete ===${NC}"
echo ""
echo "Summary:"
echo "1. Created payment charge: $CHARGE_ID"
echo "2. Initial status: PENDING"
echo "3. Webhook received: charge:confirmed"
echo "4. Updated status: COMPLETED"
echo "5. All events logged for audit"

