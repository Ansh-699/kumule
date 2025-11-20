
import { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { transferV1 } from '@metaplex-foundation/mpl-core';
import { publicKey, createNoopSigner, signerIdentity } from '@metaplex-foundation/umi';

const RPC_URL = 'https://api.devnet.solana.com';
const ESCROW_PROGRAM_ID = new PublicKey('4WYfhmmEu1MoSMDQfiN2JEbQV28gSo6vhm9idEL7ArtG');
const ASSET_ID = new PublicKey('5NLiBsjQwdd75xbt3pRuax8Xjx8dJjMvGdziYy1MLFNL');
const SELLER_ID = new PublicKey('anshxnbjGiUpsZpnx3c6LrK2vt8zt54vLMvY3C7Locm');
const ESCROW_PDA = new PublicKey('HsLPqZi7ninAdAsKbwtJEBbqDReLiQBDJLCKSBDQZDHs');

// Discriminator for cancel_escrow: [156, 203, 54, 179, 38, 72, 33, 21]
const CANCEL_DISCRIMINATOR = Buffer.from([156, 203, 54, 179, 38, 72, 33, 21]);

async function simulateCleanup() {
    const connection = new Connection(RPC_URL);
    const umi = createUmi(RPC_URL);

    console.log('Building Transfer Instruction...');
    // 1. Build Transfer Instruction (User -> Escrow PDA)
    const asset = publicKey(ASSET_ID.toBase58());
    const newOwner = publicKey(ESCROW_PDA.toBase58());
    const currentOwner = publicKey(SELLER_ID.toBase58());

    const currentOwnerSigner = createNoopSigner(currentOwner);
    umi.use(signerIdentity(currentOwnerSigner));

    const transferBuilder = transferV1(umi, {
        asset,
        newOwner,
        authority: currentOwnerSigner,
        collection: undefined,
    });

    const transferIxs = transferBuilder.getInstructions();
    console.log(`Transfer builder returned ${transferIxs.length} instructions.`);

    const transferIxUmi = transferIxs[0];

    // Convert Umi Ix to Web3 Ix manually
    const transferIxWeb3 = new TransactionInstruction({
        programId: new PublicKey(transferIxUmi.programId),
        keys: transferIxUmi.keys.map(k => ({
            pubkey: new PublicKey(k.pubkey),
            isSigner: k.isSigner,
            isWritable: k.isWritable,
        })),
        data: Buffer.from(transferIxUmi.data),
    });

    // 2. Build Cancel Escrow Instruction
    console.log('Building Cancel Escrow Instruction...');
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

    // 3. Combine in Transaction
    const { blockhash } = await connection.getLatestBlockhash();
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = SELLER_ID;
    tx.add(transferIxWeb3);
    tx.add(cancelEscrowIx);

    console.log('Simulating Transfer + Cancel...');

    try {
        // @ts-ignore
        const result = await connection.simulateTransaction(tx, [
            // We need to pass signers if we don't use sigVerify: false, but with sigVerify: false we shouldn't need them.
            // However, some versions of web3.js might complain if signers array is missing even with sigVerify: false?
            // Let's pass an empty array or mock signer if needed.
            // Actually, let's try passing undefined for signers and just options.
        ], { sigVerify: false });

        // If the above fails, try: connection.simulateTransaction(tx, undefined, { sigVerify: false })?
        // Or just: connection.simulateTransaction(tx) and let it fail signature verification but show logs?

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
        // Try fallback signature
        try {
            console.log('Retrying with different signature...');
            // @ts-ignore
            const result = await connection.simulateTransaction(tx);
            console.log('Retry Result:', result.value);
        } catch (e2) {
            console.error('Retry failed:', e2);
        }
    }
}

simulateCleanup();
