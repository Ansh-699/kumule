# NFT Marketplace Backend Testing Guide

This directory contains comprehensive test scripts for the NFT Marketplace backend endpoints.

## Test Scripts

### 1. `test-endpoints.sh` (Simple Bash/cURL Tests)

**Quick endpoint availability tests using cURL.**

#### Prerequisites
- `curl` installed
- Backend running (locally or deployed)

#### Usage

```bash
# Test local backend
./test-endpoints.sh

# Test deployed backend
BACKEND_URL=https://your-worker.workers.dev ./test-endpoints.sh
```

#### What it tests
- ✅ GET `/health` - Health check
- ✅ GET `/listings` - Fetch all listings
- ✅ GET `/owner` - Fetch NFTs by owner
- ✅ POST `/list` - List endpoint availability
- ✅ POST `/buy` - Buy endpoint availability
- ✅ POST `/cancel` - Cancel endpoint availability
- ✅ POST `/transfer` - Transfer endpoint availability

**Note**: POST endpoints are tested with invalid data to verify they exist and return proper error codes (400).

---

### 2. `test-endpoints.mjs` (Comprehensive Node.js Tests)

**Full integration tests with transaction signing and validation.**

#### Prerequisites
- Node.js 18+ installed
- `@solana/web3.js` package
- Test wallet with devnet SOL
- Backend running

#### Setup

1. **Install dependencies:**
```bash
npm install @solana/web3.js node-fetch
```

2. **Create or provide a test wallet:**

Option A: Let the script generate one
```bash
node test-endpoints.mjs
# It will create test-wallet.json and show you the address
# Fund it at: https://faucet.solana.com/
```

Option B: Use existing wallet
```bash
# Copy your wallet keypair JSON to test-wallet.json
cp ~/.config/solana/id.json ./test-wallet.json
```

#### Usage

```bash
# Test local backend
node test-endpoints.mjs

# Test deployed backend
BACKEND_URL=https://your-worker.workers.dev node test-endpoints.mjs

# Use custom wallet
WALLET_PATH=./my-wallet.json node test-endpoints.mjs

# Use custom RPC
SOLANA_RPC_URL=https://api.devnet.solana.com node test-endpoints.mjs
```

#### What it tests

| Test | Description | Requires |
|------|-------------|----------|
| GET `/health` | Backend health check | Nothing |
| GET `/listings` | Fetch all escrow listings | Backend |
| GET `/owner` | Fetch NFTs owned by wallet | Wallet |
| POST `/mint` | Mint NFT transaction | Wallet, SOL |
| POST `/list` | Create listing transaction | Wallet, NFT, SOL |
| POST `/buy` | Buy NFT transaction | Wallet, SOL, Listing |
| POST `/cancel` | Cancel listing transaction | Wallet, Listing |
| POST `/transfer` | Transfer NFT transaction | Wallet, NFT |

#### Output Example

```
============================================================
NFT Marketplace Backend Test Suite
============================================================
Backend URL: http://localhost:8787
RPC URL: https://api.devnet.solana.com

Test Wallet: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
Wallet Balance: 1.5 SOL

============================================================
Running Tests
============================================================

🧪 Testing: GET /health
✅ Backend is healthy
✅ PASSED

🧪 Testing: GET /listings
✅ Found 3 listings
  Sample listing:
    Asset: ABC123...
    Seller: XYZ789...
    Price: 1.5 SOL
    Name: Cool NFT
✅ PASSED

... (more tests)

============================================================
Test Summary
============================================================
✅ Passed: 7
❌ Failed: 0
⚠️  Skipped: 1
📊 Total: 8

🎉 All tests passed!
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BACKEND_URL` | Backend API URL | `http://localhost:8787` |
| `SOLANA_RPC_URL` | Solana RPC endpoint | `https://api.devnet.solana.com` |
| `WALLET_PATH` | Path to wallet keypair JSON | `./test-wallet.json` |

---

## Testing Workflow

### 1. Quick Smoke Test (Before Deployment)

```bash
# Start backend locally
cd workerbackend
npm run dev

# In another terminal, run quick tests
./test-endpoints.sh
```

### 2. Full Integration Test (After Deployment)

```bash
# Deploy backend
cd workerbackend
npm run deploy

# Run comprehensive tests
BACKEND_URL=https://your-worker.workers.dev node test-endpoints.mjs
```

### 3. Testing Complete Flow

```bash
# 1. Ensure you have a funded wallet
solana airdrop 2 --url devnet

# 2. Mint an NFT (use frontend or separate script)

# 3. Run tests
node test-endpoints.mjs

# 4. Check transactions on explorer
# The script will output transaction signatures
```

---

## Troubleshooting

### "Wallet has no SOL"
```bash
# Get devnet SOL
solana airdrop 2 $(cat test-wallet.json | jq -r '.[0:32] | @base64') --url devnet

# Or use web faucet
# https://faucet.solana.com/
```

### "No NFTs to list"
You need to mint an NFT first. Use the frontend or:
```bash
# Use the mint endpoint or Metaplex CLI
```

### "Backend not responding"
```bash
# Check if backend is running
curl http://localhost:8787/health

# Check logs
cd workerbackend
npm run dev
```

### "Transaction failed"
- Check wallet has enough SOL (for rent + gas)
- Verify NFT ownership
- Check escrow account exists
- View transaction on Solana Explorer

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Test Backend

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Run smoke tests
        run: ./test-endpoints.sh
        env:
          BACKEND_URL: ${{ secrets.BACKEND_URL }}
```

---

## Advanced Usage

### Testing Specific Endpoints

```javascript
// Modify test-endpoints.mjs to run specific tests
async function runTests() {
    // Comment out tests you don't want to run
    await testEndpoint('GET /health', testHealth);
    // await testEndpoint('GET /listings', ...);
}
```

### Custom Assertions

```javascript
// Add custom checks in test-endpoints.mjs
async function testGetListings() {
    const response = await fetch(`${BACKEND_URL}/listings`);
    const data = await response.json();
    
    // Custom assertion
    if (data.listings.some(l => l.price < 0)) {
        throw new Error('Found listing with negative price!');
    }
    
    return data.listings;
}
```

---

## Test Coverage

| Endpoint | Bash Script | Node.js Script |
|----------|-------------|----------------|
| GET `/health` | ✅ | ✅ |
| GET `/listings` | ✅ | ✅ |
| GET `/owner` | ✅ | ✅ |
| POST `/mint` | ✅ | ⚠️ (Skipped) |
| POST `/list` | ✅ | ✅ |
| POST `/buy` | ✅ | ✅ |
| POST `/cancel` | ✅ | ✅ |
| POST `/transfer` | ✅ | ✅ |

**Legend:**
- ✅ Fully tested
- ⚠️ Partially tested or skipped
- ❌ Not tested

---

## Contributing

To add new tests:

1. Add test function in `test-endpoints.mjs`
2. Call it in `runTests()`
3. Update this README
4. Add corresponding bash test if applicable

---

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review backend logs
3. Check Solana Explorer for transaction details
4. Open an issue on GitHub
