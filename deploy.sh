#!/bin/bash

echo "🚀 Deploying NFT Marketplace..."
echo ""

# Deploy Backend
echo "📦 Deploying Backend..."
cd /home/anshtyagi/Documents/BUN/nftmarketplace/nftmarketplace/workerbackend
bun run deploy
echo ""

# Deploy Frontend
echo "🎨 Deploying Frontend..."
cd /home/anshtyagi/Documents/BUN/nftmarketplace/nftmarketplace/frontend
bun run deploy
echo ""

echo "✅ Deployment Complete!"
echo ""
echo "Backend: https://workerbackend.ansht.workers.dev/"
echo "Frontend: Check the output above for your frontend URL"
