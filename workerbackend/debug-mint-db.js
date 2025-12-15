#!/usr/bin/env bun
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
// Mocking the getPrisma function behavior
const prisma = new client_1.PrismaClient({
    datasourceUrl: process.env.DATABASE_URL
});
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('Starting DB Debug Script...');
        const walletAddress = "TestWallet_" + Date.now();
        const name = "Debug NFT " + Date.now();
        const uri = "https://example.com/metadata.json";
        const assetKey = "Asset_" + Date.now();
        const collection = "Collection_" + Date.now();
        try {
            console.log(`1. Finding or Creating User for wallet: ${walletAddress}`);
            let user = yield prisma.user.findFirst({
                where: {
                    wallets: {
                        some: { walletAddress: walletAddress }
                    }
                }
            });
            if (!user) {
                console.log('User not found, creating new user...');
                user = yield prisma.user.create({
                    data: {
                        wallets: {
                            create: {
                                walletAddress: walletAddress,
                                walletType: 'solana'
                            }
                        }
                    }
                });
                console.log('User created:', user.id);
            }
            else {
                console.log('User found:', user.id);
            }
            console.log('2. Finding Wallet ID...');
            const wallet = yield prisma.wallet.findUnique({ where: { walletAddress: walletAddress } });
            if (wallet) {
                console.log('Wallet found:', wallet.id);
                console.log('3. Creating NFT record...');
                const nft = yield prisma.nft.create({
                    data: {
                        nftId: assetKey,
                        name: name,
                        metadataUri: uri,
                        walletId: wallet.id,
                    }
                });
                console.log('NFT created successfully:', nft.id);
            }
            else {
                console.error('CRITICAL: Wallet not found even after user creation!');
            }
        }
        catch (e) {
            console.error('FAILED to execute DB operations:', e);
        }
        finally {
            yield prisma.$disconnect();
        }
    });
}
main();
