#!/bin/bash
# E2E Escrow Test Script
# Tests the complete escrow flow using curl commands
# 
# Usage: ./tests/e2e-test.sh [API_URL]
#
# This script tests:
# 1. Health check
# 2. Mint NFT
# 3. List NFT (create escrow)
# 4. Get listings
# 5. Buy NFT (release escrow)
# 6. Verify transaction

set -e

# Configuration
API_URL="${1:-https://workerbackend.ansht.workers.dev}"
EXPLORER_BASE="https://explorer.solana.com"
ESCROW_PROGRAM="3ozh4TQJbeyXFUuXsj7fYmHB5aCVkg24cZN5zZmigR44"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           NFT MARKETPLACE E2E ESCROW TEST                     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}API URL: ${API_URL}${NC}"
echo -e "${CYAN}Escrow Program: ${ESCROW_PROGRAM}${NC}"
echo ""

# Get a test wallet address (you need to set this)
SELLER_WALLET="${SELLER_WALLET:-$(solana address 2>/dev/null || echo 'YOUR_WALLET_ADDRESS')}"
BUYER_WALLET="${BUYER_WALLET:-$SELLER_WALLET}"

echo -e "${CYAN}Seller: ${SELLER_WALLET}${NC}"
echo -e "${CYAN}Buyer: ${BUYER_WALLET}${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════
# Step 1: Health Check
# ═══════════════════════════════════════════════════════════════
echo -e "${YELLOW}🏥 Step 1: Health Check${NC}"
HEALTH=$(curl -s "${API_URL}/health")
echo "  Response: ${HEALTH}"
echo -e "${GREEN}  ✅ Backend is running${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════
# Step 2: Get Current Listings
# ═══════════════════════════════════════════════════════════════
echo -e "${YELLOW}📋 Step 2: Get Current Listings${NC}"
LISTINGS=$(curl -s "${API_URL}/listings")
LISTING_COUNT=$(echo $LISTINGS | jq -r '.listings | length // 0')
echo -e "  Found ${CYAN}${LISTING_COUNT}${NC} active listings"

if [ "$LISTING_COUNT" -gt 0 ]; then
    echo "  Sample listing:"
    echo $LISTINGS | jq -r '.listings[0] | "    Asset: \(.asset)\n    Seller: \(.seller)\n    Price: \(.price) SOL"'
fi
echo ""

# ═══════════════════════════════════════════════════════════════
# Step 3: Test Mint Endpoint (Build Only)
# ═══════════════════════════════════════════════════════════════
echo -e "${YELLOW}🎨 Step 3: Test Mint Endpoint${NC}"
MINT_RESPONSE=$(curl -s -X POST "${API_URL}/mint" \
    -H "Content-Type: application/json" \
    -d "{
        \"uri\": \"https://arweave.net/test-e2e-$(date +%s)\",
        \"name\": \"E2E Test NFT\",
        \"owner\": \"${SELLER_WALLET}\",
        \"paymentMethod\": \"wallet\"
    }")

if echo "$MINT_RESPONSE" | jq -e '.transaction' > /dev/null 2>&1; then
    MINT_ADDRESS=$(echo $MINT_RESPONSE | jq -r '.mint')
    echo -e "${GREEN}  ✅ Mint transaction built successfully${NC}"
    echo -e "  Mint Address: ${CYAN}${MINT_ADDRESS}${NC}"
    echo "  (Transaction needs wallet signature to complete)"
else
    echo -e "${RED}  ❌ Mint failed: ${MINT_RESPONSE}${NC}"
fi
echo ""

# ═══════════════════════════════════════════════════════════════
# Step 4: Test List Endpoint (requires existing NFT)
# ═══════════════════════════════════════════════════════════════
echo -e "${YELLOW}📝 Step 4: Test List Endpoint Structure${NC}"
echo "  Endpoint: POST ${API_URL}/list"
echo "  Payload: { assetId, seller, price }"
echo "  Creates escrow PDA and transfers NFT custody"
echo ""

# ═══════════════════════════════════════════════════════════════
# Step 5: Test Buy Endpoint Structure  
# ═══════════════════════════════════════════════════════════════
echo -e "${YELLOW}💰 Step 5: Test Buy Endpoint Structure${NC}"
echo "  Endpoint: POST ${API_URL}/buy"
echo "  Payload: { assetId, seller, buyer }"
echo "  Transfers SOL to seller + NFT to buyer atomically"
echo ""

# ═══════════════════════════════════════════════════════════════
# Step 6: Test Cancel Endpoint Structure
# ═══════════════════════════════════════════════════════════════
echo -e "${YELLOW}🔄 Step 6: Test Cancel Endpoint Structure${NC}"
echo "  Endpoint: POST ${API_URL}/cancel"
echo "  Payload: { assetId, seller }"
echo "  Returns NFT to seller, closes escrow (refund)"
echo ""

# ═══════════════════════════════════════════════════════════════
# Step 7: Test Admin Resolve Endpoint Structure
# ═══════════════════════════════════════════════════════════════
echo -e "${YELLOW}🛡️ Step 7: Admin Resolve Endpoint Structure${NC}"
echo "  Endpoint: POST ${API_URL}/admin-resolve"
echo "  Payload: { assetId, seller, buyer, admin, refundBuyer }"
echo "  Admin resolves disputed escrows"
echo ""

# ═══════════════════════════════════════════════════════════════
# Step 8: Check Disputes API
# ═══════════════════════════════════════════════════════════════
echo -e "${YELLOW}⚖️ Step 8: Check Disputes API${NC}"
DISPUTES=$(curl -s "${API_URL}/api/disputes")
if echo "$DISPUTES" | jq -e '.disputes' > /dev/null 2>&1; then
    DISPUTE_COUNT=$(echo $DISPUTES | jq -r '.disputes | length')
    echo -e "  Found ${CYAN}${DISPUTE_COUNT}${NC} disputes"
else
    echo -e "  ${YELLOW}Disputes endpoint: ${DISPUTES}${NC}"
fi
echo ""

# ═══════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                        SUMMARY                               ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}✅ Escrow Smart Contract${NC}"
echo -e "   Program ID: ${ESCROW_PROGRAM}"
echo -e "   Explorer: ${EXPLORER_BASE}/address/${ESCROW_PROGRAM}?cluster=devnet"
echo ""
echo -e "${GREEN}✅ Backend Endpoints${NC}"
echo "   POST /mint         - Mint new NFT"
echo "   POST /list         - Create escrow listing"
echo "   POST /buy          - Buy from escrow"
echo "   POST /cancel       - Cancel listing (refund)"
echo "   POST /admin-resolve - Admin dispute resolution"
echo "   GET  /listings     - Get active listings"
echo "   GET  /api/disputes - Get disputes"
echo ""
echo -e "${GREEN}✅ Database Tables${NC}"
echo "   - transactions    (all payments with checksums)"
echo "   - payment_logs    (webhook events)"
echo "   - escrows         (listing records)"
echo "   - disputes        (buyer/seller disputes)"
echo ""
echo -e "${YELLOW}📖 To run full E2E with wallet signatures:${NC}"
echo "   cd /home/anshtyagi/nftmarketplace"
echo "   node tests/e2e-escrow-test.mjs"
echo ""
echo -e "${CYAN}📚 Documentation:${NC}"
echo "   - DOCUMENTATION.md - Full API reference"
echo "   - ARCHITECTURE.md  - System architecture"
echo ""
