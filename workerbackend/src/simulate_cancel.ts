
import { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { Buffer } from 'buffer';

const RPC_URL = 'https://api.devnet.solana.com';
const ESCROW_PROGRAM_ID = new PublicKey('4WYfhmmEu1MoSMDQfiN2JEbQV28gSo6vhm9idEL7ArtG');
const ASSET_ID = new PublicKey('5NLiBsjQwdd75xbt3pRuax8Xjx8dJjMvGdziYy1MLFNL');
const SELLER_ID = new PublicKey('anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm');
const ESCROW_PDA = new PublicKey('HsLPqZi7ninAdAsKbwtJEBbqDReLiQBDJLCKSBDQZDHs');

// Discriminator for cancel_escrow: [156, 203, 54, 179, 38, 72, 33, 21]
const CANCEL_DISCRIMINATOR = Buffer.from([156, 203, 54, 179, 38, 72, 33, 21]);

async function simulateCancel() {
    const connection = new Connection(RPC_URL);

    const cancelEscrowKeys = [
        { pubkey: SELLER_ID, isSigner: true, isWritable: true },
        { pubkey: ASSET_ID, isSigner: false, isWritable: true },
        { pubkey: ESCROW_PDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'), isSigner: false, isWritable: false },
    ];

    const cancelEscrowIx = new TransactionInstruction({
        programId: ESCROW_PROGRAM_ID,
        keys: cancelEscrowKeys,
        data: CANCEL_DISCRIMINATOR,
    });

    const { blockhash } = await connection.getLatestBlockhash();
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = SELLER_ID;
    tx.add(cancelEscrowIx);

    console.log('Simulating cancel_escrow...');

    try {
        const result = await connection.simulateTransaction(tx);
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

simulateCancel();
