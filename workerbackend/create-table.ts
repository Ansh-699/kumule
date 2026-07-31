import { Client } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const client = new Client({
    connectionString,
    ssl: true
});

async function main() {
    try {
        await client.connect();
        console.log("Connected to database");

        const query = `
            CREATE TABLE IF NOT EXISTS "Transaction" (
                "transactionId" TEXT PRIMARY KEY,
                "userId" TEXT NOT NULL,
                "amount" TEXT NOT NULL,
                "transactionType" TEXT NOT NULL,
                "status" TEXT NOT NULL,
                "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `;

        await client.query(query);
        console.log("Table 'Transaction' created successfully");
    } catch (e) {
        console.error("Error creating table:", e);
    } finally {
        await client.end();
    }
}

main();
