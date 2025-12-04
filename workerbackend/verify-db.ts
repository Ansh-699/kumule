import { Client } from 'pg';

const connectionString = "postgresql://neondb_owner:npg_vt7iwzOL0Efe@ep-patient-credit-a1mtuesi-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

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
