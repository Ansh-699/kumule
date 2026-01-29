#!/usr/bin/env node

/**
 * Direct test of minting a single NFT without going through the API
 * This helps isolate whether the issue is with the API layer or minting itself
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore, createV1 } from '@metaplex-foundation/mpl-core';
import { keypairIdentity, generateSigner } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';

// Configuration - use same values as .dev.vars
// IMPORTANT: Set these environment variables before running
const ADMIN_WALLET_PRIVATE_KEY = process.env.ADMIN_WALLET_PRIVATE_KEY || '';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

if (!ADMIN_WALLET_PRIVATE_KEY) {
    console.error('ERROR: ADMIN_WALLET_PRIVATE_KEY environment variable is required');
    process.exit(1);
}

async function testDirectMint() {
    console.log('=== Direct NFT Mint Test ===\n');
    
    // 1. Create Umi instance
    console.log('1. Creating Umi instance...');
    console.log(`   RPC: ${SOLANA_RPC_URL.substring(0, 50)}...`);
    const umi = createUmi(SOLANA_RPC_URL).use(mplCore());
    
    // 2. Set up wallet
    console.log('\n2. Setting up admin wallet...');
    const privateKeyBytes = base58.serialize(ADMIN_WALLET_PRIVATE_KEY);
    const adminKeypair = umi.eddsa.createKeypairFromSecretKey(privateKeyBytes);
    umi.use(keypairIdentity(adminKeypair));
    console.log(`   Wallet: ${umi.identity.publicKey.toString()}`);
    
    // 3. Check balance
    console.log('\n3. Checking wallet balance...');
    const balance = await umi.rpc.getBalance(umi.identity.publicKey);
    console.log(`   Balance: ${Number(balance.basisPoints) / 1e9} SOL`);
    
    if (Number(balance.basisPoints) < 0.01 * 1e9) {
        console.error('   ERROR: Insufficient balance!');
        process.exit(1);
    }
    
    // 4. Get recent blockhash info
    console.log('\n4. Getting recent blockhash...');
    const { blockhash, lastValidBlockHeight } = await umi.rpc.getLatestBlockhash();
    console.log(`   Blockhash: ${blockhash.substring(0, 20)}...`);
    console.log(`   Last valid block height: ${lastValidBlockHeight}`);
    
    // 5. Get current block height
    const currentSlot = await umi.rpc.getSlot();
    console.log(`   Current slot: ${currentSlot}`);
    
    // 6. Create simple NFT with minimal metadata
    console.log('\n5. Creating NFT asset...');
    const asset = generateSigner(umi);
    console.log(`   Asset address: ${asset.publicKey.toString()}`);
    
    // Use a publicly accessible test image
    const testMetadataUri = 'https://arweave.net/5FVjSREzxZjQVl1d8t7EhcYtKvbWQvPpYc9X3gm9BHbs'; // Simple test URI
    
    const builder = createV1(umi, {
        asset,
        name: 'Test Medal NFT',
        uri: testMetadataUri,
        owner: umi.identity.publicKey,
    });
    
    // 7. Send transaction with different commitment levels
    console.log('\n6. Sending transaction...');
    const startTime = Date.now();
    
    try {
        // Try with 'processed' commitment first (fastest)
        console.log('   Using commitment: processed (fastest)');
        const result = await builder.sendAndConfirm(umi, { 
            send: { 
                skipPreflight: true,  // Skip simulation for speed
                maxRetries: 3
            },
            confirm: { 
                commitment: 'processed'  // Fastest confirmation
            }
        });
        
        const elapsed = Date.now() - startTime;
        const txHash = base58.deserialize(result.signature)[0];
        
        console.log(`\n✅ SUCCESS!`);
        console.log(`   Asset: ${asset.publicKey.toString()}`);
        console.log(`   Transaction: ${txHash}`);
        console.log(`   Time: ${elapsed}ms`);
        console.log(`\n   View on Solscan: https://solscan.io/tx/${txHash}?cluster=devnet`);
        console.log(`   View NFT: https://solscan.io/account/${asset.publicKey.toString()}?cluster=devnet`);
        
    } catch (error) {
        const elapsed = Date.now() - startTime;
        console.error(`\n❌ FAILED after ${elapsed}ms`);
        console.error(`   Error: ${error.message}`);
        
        // Additional debugging
        if (error.message.includes('block height')) {
            console.log('\n   Analysis: Transaction expired before confirmation');
            console.log('   This typically means network congestion or slow RPC');
            
            // Check if transaction was actually submitted
            if (error.signature) {
                console.log(`   Signature was: ${error.signature}`);
            }
        }
    }
}

testDirectMint().catch(console.error);
