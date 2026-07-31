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
            SELECT * FROM "transactions" 
            ORDER BY "updated_at" DESC 
            LIMIT 10;
        `;

        const res = await client.query(query);

        if (res.rows.length === 0) {
            console.log("No transactions found in 'transactions' table.");
        } else {
            console.log("Recent Transactions (from 'transactions' table):");
            console.table(res.rows);
        }

    } catch (e) {
        console.error("Error querying database:", e);
    } finally {
        await client.end();
    }
}

main();
