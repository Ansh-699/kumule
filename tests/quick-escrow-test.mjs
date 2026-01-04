// Quick test to complete the escrow flow with existing asset
import { Keypair, Connection, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import fs from 'fs';

const SOLANA_RPC = 'https://api.devnet.solana.com';
const connection = new Connection(SOLANA_RPC, 'confirmed');

// Load seller wallet
const keypairData = JSON.parse(fs.readFileSync(process.env.HOME + '/.config/solana/id.json', 'utf-8'));
const seller = Keypair.fromSecretKey(Uint8Array.from(keypairData));

// Load buyer wallet
const buyerData = JSON.parse(fs.readFileSync('.keypairs/buyer.json', 'utf-8'));
const buyer = Keypair.fromSecretKey(Uint8Array.from(buyerData));

const ASSET_ID = 'ErR29xyvQQr3tuqL4s2RvGcJGo7KpMuF1KsBvZe6MZcw';  // Latest minted NFT
const API_URL = 'https://workerbackend.ansht.workers.dev';

async function signAndSend(txBase64, signers, label) {
    const txBuffer = Buffer.from(txBase64, 'base64');
    const tx = Transaction.from(txBuffer);
    tx.sign(...signers);
    console.log(`Sending ${label}...`);
    const sig = await sendAndConfirmTransaction(connection, tx, signers);
    console.log(`✅ ${label}: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    return sig;
}

async function run() {
    console.log('Seller:', seller.publicKey.toString());
    console.log('Buyer:', buyer.publicKey.toString());
    console.log('Asset:', ASSET_ID);
    console.log('');

    // Step 1: List the NFT
    console.log('📋 Step 1: Listing NFT for 0.1 SOL...');
    const listRes = await fetch(`${API_URL}/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            assetId: ASSET_ID,
            seller: seller.publicKey.toString(),
            price: 0.1
        })
    });
    
    if (!listRes.ok) {
        console.log('List failed:', await listRes.text());
        return;
    }
    
    const listData = await listRes.json();
    console.log('Escrow PDA:', listData.escrow);
    await signAndSend(listData.transaction, [seller], 'LIST');
    
    // Wait for indexing
    console.log('Waiting 5 seconds for indexing...');
    await new Promise(r => setTimeout(r, 5000));

    // Step 2: Verify listing
    console.log('\n🔍 Step 2: Verifying listing...');
    const listingsRes = await fetch(`${API_URL}/listings`);
    const listings = await listingsRes.json();
    const ourListing = listings.listings?.find(l => l.asset === ASSET_ID);
    if (ourListing) {
        console.log('✅ Found listing:', ourListing);
    } else {
        console.log('⚠️ Listing not visible yet (may take time)');
    }

    // Step 3: Buy the NFT
    console.log('\n💰 Step 3: Buying NFT...');
    const buyRes = await fetch(`${API_URL}/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            assetId: ASSET_ID,
            seller: seller.publicKey.toString(),
            buyer: buyer.publicKey.toString()
        })
    });
    
    if (!buyRes.ok) {
        console.log('Buy failed:', await buyRes.text());
        
        // Try cancel instead
        console.log('\n🔄 Trying cancel instead...');
        const cancelRes = await fetch(`${API_URL}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                assetId: ASSET_ID,
                seller: seller.publicKey.toString()
            })
        });
        
        if (cancelRes.ok) {
            const cancelData = await cancelRes.json();
            await signAndSend(cancelData.transaction, [seller], 'CANCEL');
        }
        return;
    }
    
    const buyData = await buyRes.json();
    await signAndSend(buyData.transaction, [buyer], 'BUY');
    
    console.log('\n✅ ESCROW FLOW COMPLETE!');
    console.log('   - NFT transferred from seller to buyer');
    console.log('   - 0.1 SOL transferred from buyer to seller');
}

run().catch(console.error);
