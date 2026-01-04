#!/usr/bin/env node
/**
 * End-to-End Escrow Test Script
 * Tests: Payment → Mint → List → Buy → Release / Refund
 * 
 * Prerequisites:
 * - Solana CLI installed
 * - Keypair at ~/.config/solana/id.json
 * - Backend running at API_URL
 * 
 * Run: node tests/e2e-escrow-test.mjs
 */

import { Keypair, Connection, VersionedTransaction, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

// Configuration
const API_URL = process.env.API_URL || 'https://workerbackend.ansht.workers.dev';
const SOLANA_RPC = 'https://api.devnet.solana.com';
const ESCROW_PROGRAM_ID = '3ozh4TQJbeyXFUuXsj7fYmHB5aCVkg24cZN5zZmigR44';
const EXPLORER_BASE = 'https://explorer.solana.com';

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function explorerLink(signature, type = 'tx') {
    return `${EXPLORER_BASE}/${type}/${signature}?cluster=devnet`;
}

// Load keypair from file or generate new one
function loadOrGenerateKeypair(name) {
    const keypairPath = path.join(process.cwd(), `.keypairs/${name}.json`);
    try {
        if (fs.existsSync(keypairPath)) {
            const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
            return Keypair.fromSecretKey(Uint8Array.from(keypairData));
        }
    } catch (e) {}
    
    // Generate new keypair
    const keypair = Keypair.generate();
    fs.mkdirSync(path.dirname(keypairPath), { recursive: true });
    fs.writeFileSync(keypairPath, JSON.stringify(Array.from(keypair.secretKey)));
    return keypair;
}

// Load main wallet from Solana CLI config
function loadMainWallet() {
    const configPath = path.join(process.env.HOME, '.config/solana/id.json');
    if (!fs.existsSync(configPath)) {
        throw new Error('Solana keypair not found. Run: solana-keygen new');
    }
    const keypairData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return Keypair.fromSecretKey(Uint8Array.from(keypairData));
}

// Request airdrop if balance is low
async function ensureFunded(connection, publicKey, minBalance = 0.5) {
    const balance = await connection.getBalance(publicKey);
    const balanceInSol = balance / 1e9;
    log(`  Balance: ${balanceInSol.toFixed(4)} SOL`, 'cyan');
    
    if (balanceInSol < minBalance) {
        log(`  Requesting airdrop...`, 'yellow');
        try {
            const sig = await connection.requestAirdrop(publicKey, 1e9); // 1 SOL
            await connection.confirmTransaction(sig, 'confirmed');
            log(`  Airdrop successful: ${explorerLink(sig)}`, 'green');
        } catch (e) {
            log(`  Airdrop failed (rate limited?): ${e.message}`, 'red');
        }
    }
}

// Send transaction and return signature
async function sendTransaction(connection, txBase64, signers) {
    const txBuffer = Buffer.from(txBase64, 'base64');
    
    // Try VersionedTransaction first, fall back to legacy
    let tx;
    try {
        tx = VersionedTransaction.deserialize(new Uint8Array(txBuffer));
        tx.sign(signers);
        const signature = await connection.sendTransaction(tx);
        await connection.confirmTransaction(signature, 'confirmed');
        return signature;
    } catch (e) {
        // Try legacy transaction
        tx = Transaction.from(txBuffer);
        tx.sign(...signers);
        const signature = await sendAndConfirmTransaction(connection, tx, signers);
        return signature;
    }
}

// Test results storage
const results = {
    transactions: [],
    errors: [],
};

async function runE2ETest() {
    log('\n╔══════════════════════════════════════════════════════════════╗', 'blue');
    log('║           NFT MARKETPLACE E2E ESCROW TEST                     ║', 'blue');
    log('╚══════════════════════════════════════════════════════════════╝\n', 'blue');

    const connection = new Connection(SOLANA_RPC, 'confirmed');
    
    // Load wallets
    log('📦 Step 0: Loading Wallets', 'yellow');
    const seller = loadMainWallet();
    const buyer = loadOrGenerateKeypair('buyer');
    log(`  Seller: ${seller.publicKey.toString()}`, 'cyan');
    log(`  Buyer:  ${buyer.publicKey.toString()}`, 'cyan');
    
    // Ensure wallets are funded
    await ensureFunded(connection, seller.publicKey);
    await ensureFunded(connection, buyer.publicKey);
    
    let mintAddress = null;
    let listTxSig = null;
    let buyTxSig = null;

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: MINT NFT
    // ═══════════════════════════════════════════════════════════════
    log('\n🎨 Step 1: Minting NFT', 'yellow');
    try {
        const mintPayload = {
            uri: `https://arweave.net/test-e2e-${Date.now()}`,
            name: `E2E Test NFT ${Date.now()}`,
            owner: seller.publicKey.toString(),
            paymentMethod: 'wallet'
        };
        
        log(`  Calling ${API_URL}/mint...`, 'cyan');
        const mintResponse = await fetch(`${API_URL}/mint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mintPayload),
        });

        if (!mintResponse.ok) {
            throw new Error(`Mint failed: ${await mintResponse.text()}`);
        }

        const mintData = await mintResponse.json();
        mintAddress = mintData.mint;
        log(`  ✅ Transaction built for mint: ${mintAddress}`, 'green');

        // Sign and send
        const mintSig = await sendTransaction(connection, mintData.transaction, [seller]);
        log(`  ✅ Mint confirmed: ${explorerLink(mintSig)}`, 'green');
        
        results.transactions.push({
            step: 'mint',
            signature: mintSig,
            assetId: mintAddress,
            explorerLink: explorerLink(mintSig)
        });
    } catch (error) {
        log(`  ❌ Mint failed: ${error.message}`, 'red');
        results.errors.push({ step: 'mint', error: error.message });
        return results;
    }

    // Wait for on-chain state to settle and verify asset exists
    log('\n⏳ Waiting for asset to be indexed...', 'yellow');
    let assetVerified = false;
    for (let attempt = 1; attempt <= 10; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds between attempts
        
        try {
            const accountInfo = await connection.getAccountInfo(new (await import('@solana/web3.js')).PublicKey(mintAddress));
            if (accountInfo && accountInfo.data.length > 0) {
                log(`  ✅ Asset verified on-chain (attempt ${attempt})`, 'green');
                log(`  📍 Asset: ${explorerLink(mintAddress, 'address')}`, 'cyan');
                assetVerified = true;
                break;
            }
        } catch (e) {
            log(`  Attempt ${attempt}/10: Asset not yet indexed...`, 'cyan');
        }
    }
    
    if (!assetVerified) {
        log(`  ❌ Asset not found after 30 seconds. The mint may have failed.`, 'red');
        log(`  Check the transaction: ${results.transactions[0]?.explorerLink}`, 'yellow');
        results.errors.push({ step: 'verify_mint', error: 'Asset not indexed after mint' });
        return results;
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: LIST NFT FOR SALE (CREATE ESCROW)
    // ═══════════════════════════════════════════════════════════════
    log('\n📋 Step 2: Listing NFT for Sale (0.1 SOL)', 'yellow');
    
    // Retry logic for listing (RPC indexing can be slow)
    let listData = null;
    let listError = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const listPayload = {
                assetId: mintAddress,
                seller: seller.publicKey.toString(),
                price: 0.1 // SOL
            };
            
            log(`  Attempt ${attempt}/5: Calling ${API_URL}/list...`, 'cyan');
            const listResponse = await fetch(`${API_URL}/list`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(listPayload),
            });

            if (!listResponse.ok) {
                const errText = await listResponse.text();
                if (errText.includes('AccountNotFoundError') || errText.includes('was not found')) {
                    log(`  RPC hasn't indexed yet, retrying in 5s...`, 'yellow');
                    await new Promise(r => setTimeout(r, 5000));
                    continue;
                }
                throw new Error(`List failed: ${errText}`);
            }

            listData = await listResponse.json();
            log(`  ✅ Transaction built, signing...`, 'green');
            break;
        } catch (e) {
            listError = e;
            if (attempt < 5) {
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }
    
    if (!listData) {
        log(`  ❌ List failed after 5 attempts: ${listError?.message}`, 'red');
        results.errors.push({ step: 'list', error: listError?.message || 'Unknown error' });
    } else {
        try {
            // Sign and send
            listTxSig = await sendTransaction(connection, listData.transaction, [seller]);
            log(`  ✅ Listed on escrow: ${explorerLink(listTxSig)}`, 'green');
            log(`  📍 Escrow Program: ${explorerLink(ESCROW_PROGRAM_ID, 'address')}`, 'cyan');
            
            results.transactions.push({
                step: 'list',
                signature: listTxSig,
                assetId: mintAddress,
                price: 0.1,
                explorerLink: explorerLink(listTxSig)
            });
        } catch (error) {
            log(`  ❌ List tx failed: ${error.message}`, 'red');
            results.errors.push({ step: 'list', error: error.message });
        }
    }

    // Wait for escrow to be created
    await new Promise(resolve => setTimeout(resolve, 2000));

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: VERIFY LISTING
    // ═══════════════════════════════════════════════════════════════
    log('\n🔍 Step 3: Verifying Listing', 'yellow');
    try {
        const listingsResponse = await fetch(`${API_URL}/listings`);
        const listingsData = await listingsResponse.json();
        
        const ourListing = listingsData.listings?.find(l => l.asset === mintAddress);
        if (ourListing) {
            log(`  ✅ Found listing:`, 'green');
            log(`     Asset: ${ourListing.asset}`, 'cyan');
            log(`     Seller: ${ourListing.seller}`, 'cyan');
            log(`     Price: ${ourListing.price} SOL`, 'cyan');
            log(`     Escrow PDA: ${ourListing.escrow}`, 'cyan');
        } else {
            log(`  ⚠️ Listing not found in API (may need time to index)`, 'yellow');
        }
    } catch (error) {
        log(`  ⚠️ Could not verify listing: ${error.message}`, 'yellow');
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 4: BUY NFT (RELEASE ESCROW)
    // ═══════════════════════════════════════════════════════════════
    log('\n💰 Step 4: Buying NFT (Releases Escrow)', 'yellow');
    
    // Only try to buy if listing succeeded
    if (!listTxSig) {
        log(`  ⚠️ Skipping buy - listing didn't succeed`, 'yellow');
    } else {
        // Retry logic for buy (RPC indexing can be slow)
        let buyData = null;
        let buyError = null;
        for (let attempt = 1; attempt <= 5; attempt++) {
            try {
                const buyPayload = {
                    assetId: mintAddress,
                    seller: seller.publicKey.toString(),
                    buyer: buyer.publicKey.toString()
                };
                
                log(`  Attempt ${attempt}/5: Calling ${API_URL}/buy...`, 'cyan');
                const buyResponse = await fetch(`${API_URL}/buy`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(buyPayload),
                });

                if (!buyResponse.ok) {
                    const errText = await buyResponse.text();
                    if (errText.includes('AccountNotFoundError') || errText.includes('was not found')) {
                        log(`  RPC hasn't indexed yet, retrying in 5s...`, 'yellow');
                        await new Promise(r => setTimeout(r, 5000));
                        continue;
                    }
                    throw new Error(`Buy failed: ${errText}`);
                }

                buyData = await buyResponse.json();
                log(`  ✅ Transaction built, signing with buyer...`, 'green');
                break;
            } catch (e) {
                buyError = e;
                if (attempt < 5) {
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
        }
        
        if (buyData) {
            try {
                // Sign and send with buyer
                buyTxSig = await sendTransaction(connection, buyData.transaction, [buyer]);
                log(`  ✅ Purchase complete! ${explorerLink(buyTxSig)}`, 'green');
                log(`  💸 0.1 SOL transferred to seller`, 'green');
                log(`  🖼️ NFT transferred to buyer`, 'green');
                
                results.transactions.push({
                    step: 'buy',
                    signature: buyTxSig,
                    assetId: mintAddress,
                    buyer: buyer.publicKey.toString(),
                    explorerLink: explorerLink(buyTxSig)
                });
            } catch (error) {
                log(`  ❌ Buy tx failed: ${error.message}`, 'red');
                results.errors.push({ step: 'buy', error: error.message });
            }
        } else {
            log(`  ❌ Buy failed after 5 attempts: ${buyError?.message}`, 'red');
            results.errors.push({ step: 'buy', error: buyError?.message || 'Unknown error' });
        }
    }
    
    // If buy failed and listing succeeded, try cancel
    if (!buyTxSig && listTxSig) {
        log('\n🔄 Step 4b: Testing Cancel/Refund Flow', 'yellow');
        try {
            const cancelPayload = {
                assetId: mintAddress,
                seller: seller.publicKey.toString()
            };
            
            const cancelResponse = await fetch(`${API_URL}/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cancelPayload),
            });

            if (!cancelResponse.ok) {
                throw new Error(`Cancel failed: ${await cancelResponse.text()}`);
            }

            const cancelData = await cancelResponse.json();
            const cancelSig = await sendTransaction(connection, cancelData.transaction, [seller]);
            log(`  ✅ Listing cancelled (refund): ${explorerLink(cancelSig)}`, 'green');
            
            results.transactions.push({
                step: 'cancel',
                signature: cancelSig,
                assetId: mintAddress,
                explorerLink: explorerLink(cancelSig)
            });
        } catch (cancelError) {
            log(`  ❌ Cancel also failed: ${cancelError.message}`, 'red');
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 5: VERIFY DATABASE RECORDS
    // ═══════════════════════════════════════════════════════════════
    log('\n📊 Step 5: Checking Database Records', 'yellow');
    try {
        // Check transactions in database
        const txResponse = await fetch(`${API_URL}/api/admin/dashboard`, {
            headers: { 'x-admin-key': process.env.ADMIN_API_KEY || '' }
        });
        if (txResponse.ok) {
            const dashboardData = await txResponse.json();
            log(`  ✅ Dashboard accessible`, 'green');
            log(`     Total NFTs: ${dashboardData.nftCount || 'N/A'}`, 'cyan');
            log(`     Total Transactions: ${dashboardData.transactionCount || 'N/A'}`, 'cyan');
        }
    } catch (error) {
        log(`  ⚠️ Could not access admin dashboard: ${error.message}`, 'yellow');
    }

    // ═══════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════
    log('\n╔══════════════════════════════════════════════════════════════╗', 'blue');
    log('║                        TEST SUMMARY                           ║', 'blue');
    log('╚══════════════════════════════════════════════════════════════╝\n', 'blue');

    log('📋 Transactions:', 'yellow');
    for (const tx of results.transactions) {
        log(`  ${tx.step.toUpperCase()}: ${tx.explorerLink}`, 'green');
    }

    if (results.errors.length > 0) {
        log('\n❌ Errors:', 'red');
        for (const err of results.errors) {
            log(`  ${err.step}: ${err.error}`, 'red');
        }
    }

    log('\n📚 Key Addresses:', 'yellow');
    log(`  Escrow Program:  ${explorerLink(ESCROW_PROGRAM_ID, 'address')}`, 'cyan');
    log(`  Seller Wallet:   ${explorerLink(seller.publicKey.toString(), 'address')}`, 'cyan');
    log(`  Buyer Wallet:    ${explorerLink(buyer.publicKey.toString(), 'address')}`, 'cyan');
    if (mintAddress) {
        log(`  NFT Asset:       ${explorerLink(mintAddress, 'address')}`, 'cyan');
    }

    // Save results to file
    const resultsPath = path.join(process.cwd(), 'tests/e2e-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    log(`\n💾 Results saved to: ${resultsPath}`, 'green');

    return results;
}

// Run the test
runE2ETest()
    .then(results => {
        if (results.errors.length === 0) {
            log('\n✅ ALL TESTS PASSED!', 'green');
            process.exit(0);
        } else {
            log('\n⚠️ TESTS COMPLETED WITH ERRORS', 'yellow');
            process.exit(1);
        }
    })
    .catch(error => {
        log(`\n❌ FATAL ERROR: ${error.message}`, 'red');
        console.error(error);
        process.exit(1);
    });
