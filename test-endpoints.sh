#!/bin/bash

# Simple cURL-based test script for NFT Marketplace Backend
# This tests basic endpoint availability without requiring Solana setup

set -e

# Configuration
BACKEND_URL="${BACKEND_URL:-http://localhost:8787}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Test counters
PASSED=0
FAILED=0

echo -e "${CYAN}================================${NC}"
echo -e "${CYAN}NFT Marketplace Backend Tests${NC}"
echo -e "${CYAN}================================${NC}"
echo -e "Backend URL: ${BACKEND_URL}\n"

# Helper functions
test_endpoint() {
    local name="$1"
    local method="$2"
    local endpoint="$3"
    local data="$4"
    local expected_status="${5:-200}"
    
    echo -e "${BLUE}🧪 Testing: ${name}${NC}"
    
    if [ -z "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" "${BACKEND_URL}${endpoint}")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "${BACKEND_URL}${endpoint}")
    fi
    
    # Split response and status code
    status_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$status_code" -eq "$expected_status" ]; then
        echo -e "${GREEN}✅ PASSED${NC} (Status: $status_code)"
        if [ ! -z "$body" ]; then
            echo -e "${YELLOW}Response: ${body:0:200}${NC}"
        fi
        ((PASSED++))
    else
        echo -e "${RED}❌ FAILED${NC} (Expected: $expected_status, Got: $status_code)"
        echo -e "${RED}Response: $body${NC}"
        ((FAILED++))
    fi
    echo ""
}

# Run tests
echo -e "${CYAN}Running Tests...${NC}\n"

# Test 1: Health check
test_endpoint "GET /health" "GET" "/health"

# Test 2: Get listings
test_endpoint "GET /listings" "GET" "/listings"

# Test 3: Get NFTs by owner (with a sample address)
SAMPLE_ADDRESS="11111111111111111111111111111111"
test_endpoint "GET /owner" "GET" "/owner?owner=${SAMPLE_ADDRESS}"

# Test 4: POST /list (will fail without valid data, but tests endpoint exists)
LIST_DATA='{
  "assetId": "11111111111111111111111111111111",
  "seller": "11111111111111111111111111111111",
  "price": 1.0
}'
test_endpoint "POST /list (invalid data)" "POST" "/list" "$LIST_DATA" 400

# Test 5: POST /buy (will fail without valid data, but tests endpoint exists)
BUY_DATA='{
  "assetId": "11111111111111111111111111111111",
  "buyer": "11111111111111111111111111111111",
  "seller": "11111111111111111111111111111111"
}'
test_endpoint "POST /buy (invalid data)" "POST" "/buy" "$BUY_DATA" 400

# Test 6: POST /cancel (will fail without valid data, but tests endpoint exists)
CANCEL_DATA='{
  "assetId": "11111111111111111111111111111111",
  "seller": "11111111111111111111111111111111"
}'
test_endpoint "POST /cancel (invalid data)" "POST" "/cancel" "$CANCEL_DATA" 400

# Test 7: POST /transfer (will fail without valid data, but tests endpoint exists)
TRANSFER_DATA='{
  "assetId": "11111111111111111111111111111111",
  "newOwner": "11111111111111111111111111111111",
  "currentOwner": "11111111111111111111111111111111"
}'
test_endpoint "POST /transfer (invalid data)" "POST" "/transfer" "$TRANSFER_DATA" 400

# Print summary
echo -e "${CYAN}================================${NC}"
echo -e "${CYAN}Test Summary${NC}"
echo -e "${CYAN}================================${NC}"
echo -e "${GREEN}✅ Passed: ${PASSED}${NC}"
echo -e "${RED}❌ Failed: ${FAILED}${NC}"
echo -e "${CYAN}📊 Total: $((PASSED + FAILED))${NC}"

if [ $FAILED -gt 0 ]; then
    echo -e "\n${RED}⚠️  Some tests failed.${NC}"
    exit 1
else
    echo -e "\n${GREEN}🎉 All tests passed!${NC}"
    exit 0
fi
