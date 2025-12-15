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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log('Connecting to database...');
            // Try to count users (should be 0 or more, but proves connection)
            const count = yield prisma.user.count();
            console.log(`Successfully connected! Found ${count} users.`);
            // Create a dummy transaction to verify write access
            const tx = yield prisma.transaction.create({
                data: {
                    transactionId: 'test-connection-' + Date.now(),
                    userId: 'test-user',
                    amount: 0,
                    transactionType: 'TEST',
                    status: 'PENDING'
                }
            });
            console.log('Successfully created test transaction:', tx.transactionId);
            // Clean up
            yield prisma.transaction.delete({
                where: { id: tx.id }
            });
            console.log('Successfully deleted test transaction.');
        }
        catch (e) {
            console.error('Database connection failed:', e);
            process.exit(1);
        }
        finally {
            yield prisma.$disconnect();
        }
    });
}
main();
