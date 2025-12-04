#!/bin/bash

# Default to localhost:8787 if not provided
# Default to localhost:8787 if not provided
WORKER_URL="${1:-http://localhost:8787}"

echo "Simulating Coinbase Webhook to $WORKER_URL/api/webhooks/coinbase"

# Use provided Charge ID or generate a random one
CHARGE_ID="${2:-test_charge_$(date +%s)}"

# Payload
PAYLOAD=$(cat <<EOF
{
  "event": {
    "type": "charge:confirmed",
    "data": {
      "id": "$CHARGE_ID",
      "code": "TEST_CODE",
      "pricing": {
        "local": {
          "amount": "10.00",
          "currency": "USD"
        }
      },
      "payments": []
    }
  }
}
EOF
)

# Send request
curl -X POST "$WORKER_URL/api/webhooks/coinbase" \
  -H "Content-Type: application/json" \
  -H "X-CC-Webhook-Signature: dummy_signature_for_local_test" \
  -d "$PAYLOAD"

echo -e "\n\nSent webhook for charge ID: $CHARGE_ID"
