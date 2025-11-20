
import { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { BN } from 'bn.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { fetchAssetV1 } from '@metaplex-foundation/mpl-core';
import { publicKey } from '@metaplex-foundation/umi';

const RPC_URL = 'https://api.devnet.solana.com';
const ESCROW_PROGRAM_ID = new PublicKey('4WYfhmmEu1MoSMDQfiN2JEbQV28gSo6vhm9idEL7ArtG');
// Using the new reported account details
const ASSET_ID = new PublicKey('4YGPRgavtt4cwNeYz2rt1ff4M375DF8fQcoemqDvsNZ8');
const SELLER_ID = new PublicKey('anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm');
const ESCROW_PDA = new PublicKey('DEkwXUe97zjD5e3vhvhGESSkwBcdYQ5BsqF66yosaJdS');

// Discriminators
const CREATE_DISCRIMINATOR = Buffer.from([253, 215, 165, 116, 36, 108, 68, 80]);
const DEPOSIT_DISCRIMINATOR = Buffer.from([107, 93, 89, 87, 226, 203, 154, 19]);
const CLOSE_DISCRIMINATOR = Buffer.from([139, 171, 94, 146, 191, 91, 144, 50]);

async function simulateListFix() {
    const connection = new Connection(RPC_URL);
    const umi = createUmi(RPC_URL);

    console.log('Building Transaction...');
    const tx = new Transaction();

    // 1. Close Escrow Instruction (Simulating the fix)
    console.log('Adding Close Escrow Instruction...');
    const closeEscrowIx = new TransactionInstruction({
        programId: ESCROW_PROGRAM_ID,
        keys: [
            { pubkey: SELLER_ID, isSigner: true, isWritable: true },
            { pubkey: ESCROW_PDA, isSigner: false, isWritable: true },
        ],
        data: CLOSE_DISCRIMINATOR,
    });
    tx.add(closeEscrowIx);

    // 2. Create Escrow Instruction
    console.log('Adding Create Escrow Instruction...');
    const price = 0.5 * 1e9; // 0.5 SOL
    const createEscrowIx = new TransactionInstruction({
        programId: ESCROW_PROGRAM_ID,
        keys: [
            { pubkey: SELLER_ID, isSigner: true, isWritable: true },
            { pubkey: ASSET_ID, isSigner: false, isWritable: false },
            { pubkey: ESCROW_PDA, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([
            ...CREATE_DISCRIMINATOR,
            ...new BN(price).toArray('le', 8),
            0, // buyer = None
        ]),
    });
    tx.add(createEscrowIx);

    // 3. Deposit Asset Instruction
    console.log('Adding Deposit Asset Instruction...');
    const asset = await fetchAssetV1(umi, publicKey(ASSET_ID.toBase58()));

    const depositAssetKeys = [
        { pubkey: SELLER_ID, isSigner: true, isWritable: true },
        { pubkey: ASSET_ID, isSigner: false, isWritable: true },
        { pubkey: ESCROW_PDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'), isSigner: false, isWritable: false },
    ];

    if (asset.updateAuthority.type === 'Collection' && asset.updateAuthority.address) {
        depositAssetKeys.push({
            pubkey: new PublicKey(asset.updateAuthority.address.toString()),
            isSigner: false,
            isWritable: false
        });
    }

    if (asset.pluginHeader) {
        depositAssetKeys.push({
            pubkey: new PublicKey(asset.pluginHeader.key),
            isSigner: false,
            isWritable: true
        });
    }

    const depositAssetIx = new TransactionInstruction({
        programId: ESCROW_PROGRAM_ID,
        keys: depositAssetKeys,
        data: DEPOSIT_DISCRIMINATOR,
    });
    tx.add(depositAssetIx);

    // Simulate
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = SELLER_ID;

    console.log('Simulating Full Listing Flow (Close -> Create -> Deposit)...');

    try {
        // @ts-ignore
        const result = await connection.simulateTransaction(tx, undefined, { sigVerify: false });
        console.log('Simulation Result:', result.value);
        if (result.value.err) {
            console.error('Simulation Error:', result.value.err);
            console.log('Logs:', result.value.logs);
        } else {
            console.log('Simulation Success!');
            console.log('Logs:', result.value.logs);
        }
    } catch (e) {
        console.error('Error simulating:', e);
    }
}

simulateListFix();
