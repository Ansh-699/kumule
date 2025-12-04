// Test to verify the transaction has signatures
import { VersionedTransaction } from '@solana/web3.js';

const testTransactionSignatures = async () => {
    const API_URL = 'https://workerbackend.ansht.workers.dev/mint';

    const testData = {
        uri: 'https://arweave.net/test-metadata-uri',
        name: 'Test NFT',
        owner: '11111111111111111111111111111111'
    };

    console.log('🧪 Testing transaction signatures...\n');

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Error:', errorText);
            return;
        }

        const data = await response.json();
        console.log('✅ Received transaction from backend');
        console.log('   Mint address:', data.mint);

        // Deserialize the transaction
        const txBuffer = Buffer.from(data.transaction, 'base64');
        const tx = VersionedTransaction.deserialize(new Uint8Array(txBuffer));

        console.log('\n📝 Transaction details:');
        console.log('   - Signatures count:', tx.signatures.length);

        tx.signatures.forEach((sig, index) => {
            const isZero = sig.every(byte => byte === 0);
            console.log(`   - Signature ${index}:`, isZero ? '❌ EMPTY (needs signing)' : '✅ SIGNED');
        });

        const signedCount = tx.signatures.filter(sig => !sig.every(byte => byte === 0)).length;
        const unsignedCount = tx.signatures.length - signedCount;

        console.log('\n📊 Summary:');
        console.log(`   - Signed: ${signedCount}`);
        console.log(`   - Unsigned: ${unsignedCount}`);

        if (signedCount > 0 && unsignedCount > 0) {
            console.log('\n✅ Partial signing is working correctly!');
            console.log('   Backend signed with asset signer, frontend needs to sign with user wallet.');
        } else if (signedCount === 0) {
            console.log('\n❌ No signatures found - backend is not signing!');
        } else {
            console.log('\n⚠️  All signatures present - might be fully signed?');
        }

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error);
    }
};

testTransactionSignatures();
