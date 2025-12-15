"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const connectionString = "postgresql://neondb_owner:npg_vt7iwzOL0Efe@ep-patient-credit-a1mtuesi-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const client = new pg_1.Client({
    connectionString,
    ssl: true
});
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield client.connect();
            console.log("Connected to database");
            const query = `
            SELECT * FROM "transactions" 
            ORDER BY "updated_at" DESC 
            LIMIT 10;
        `;
            const res = yield client.query(query);
            if (res.rows.length === 0) {
                console.log("No transactions found in 'transactions' table.");
            }
            else {
                console.log("Recent Transactions (from 'transactions' table):");
                console.table(res.rows);
            }
        }
        catch (e) {
            console.error("Error querying database:", e);
        }
        finally {
            yield client.end();
        }
    });
}
main();
