
import { Connection, PublicKey } from '@solana/web3.js';

const RPC_URL = 'https://api.devnet.solana.com'; // Assuming devnet, or use mainnet if needed
const ACCOUNT_ADDRESS = 'DEkwXUe97zjD5e3vhvhGESSkwBcdYQ5BsqF66yosaJdS';

async function checkAccount() {
    const connection = new Connection(RPC_URL);
    const pubkey = new PublicKey(ACCOUNT_ADDRESS);

    console.log(`Checking account: ${ACCOUNT_ADDRESS}`);

    const accountInfo = await connection.getAccountInfo(pubkey);

    if (accountInfo) {
        console.log('Account exists!');
        console.log('Owner:', accountInfo.owner.toString());
        console.log('Lamports:', accountInfo.lamports);
        console.log('Data Length:', accountInfo.data.length);
        console.log('Data (Base64):', accountInfo.data.toString('base64'));

        // Try to parse if it's our escrow layout
        // Layout: 
        // 8 bytes discriminator
        // 32 bytes asset
        // 32 bytes seller
        // 1 byte option + 32 bytes buyer (optional)
        // 8 bytes price
        // 1 byte bump
        // 1 byte status

        try {
            const data = accountInfo.data;
            let offset = 8;
            const asset = new PublicKey(data.slice(offset, offset + 32));
            offset += 32;
            const seller = new PublicKey(data.slice(offset, offset + 32));
            offset += 32;

            const hasBuyer = data[offset] === 1;
            offset += 1;
            let buyer = null;
            if (hasBuyer) {
                buyer = new PublicKey(data.slice(offset, offset + 32));
                offset += 32;
            }

            const price = data.readBigUInt64LE(offset);
            offset += 8;
            const bump = data[offset];
            offset += 1;
            const status = data[offset];

            console.log('Parsed Escrow Data:');
            console.log('Asset:', asset.toString());
            console.log('Seller:', seller.toString());
            console.log('Buyer:', buyer ? buyer.toString() : 'None');
            console.log('Price:', price.toString());
            console.log('Bump:', bump);
            console.log('Status:', status); // 0=Pending, 1=Deposited, 2=Completed, 3=Cancelled
        } catch (e) {
            console.log('Failed to parse data:', e);
        }

    } else {
        console.log('Account does not exist.');
    }
}

checkAccount();
