
import { sha256 } from 'js-sha256';
import { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';

const RPC_URL = 'https://api.devnet.solana.com';
const ESCROW_PROGRAM_ID = new PublicKey('4WYfhmmEu1MoSMDQfiN2JEbQV28gSo6vhm9idEL7ArtG');
const ASSET_ID = new PublicKey('5NLiBsjQwdd75xbt3pRuax8Xjx8dJjMvGdziYy1MLFNL');
const SELLER_ID = new PublicKey('anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm');
const ESCROW_PDA = new PublicKey('HsLPqZi7ninAdAsKbwtJEBbqDReLiQBDJLCKSBDQZDHs');

// Calculate discriminator
function getDiscriminator(name) {
    const hash = sha256.digest(`global:${name}`);
    return hash.slice(0, 8);
}

const CLOSE_DISCRIMINATOR = getDiscriminator('close_escrow');
console.log('close_escrow discriminator:', CLOSE_DISCRIMINATOR);

async function simulateClose() {
    const connection = new Connection(RPC_URL);

    // Accounts for CloseEscrow:
    // seller: Signer
    // escrow: Account (mut, close=seller)

    const closeEscrowKeys = [
        { pubkey: SELLER_ID, isSigner: true, isWritable: true },
        { pubkey: ESCROW_PDA, isSigner: false, isWritable: true },
    ];

    const closeEscrowIx = new TransactionInstruction({
        programId: ESCROW_PROGRAM_ID,
        keys: closeEscrowKeys,
        data: Buffer.from(CLOSE_DISCRIMINATOR),
    });

    const { blockhash } = await connection.getLatestBlockhash();
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = SELLER_ID;
    tx.add(closeEscrowIx);

    console.log('Simulating close_escrow...');

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

simulateClose();
