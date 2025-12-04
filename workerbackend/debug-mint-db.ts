#!/usr/bin/env bun
import { PrismaClient } from '@prisma/client'
import dotenv from 'dotenv'

dotenv.config()

// Mocking the getPrisma function behavior
const prisma = new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL
})

async function main() {
    console.log('Starting DB Debug Script...')

    const walletAddress = "TestWallet_" + Date.now();
    const name = "Debug NFT " + Date.now();
    const uri = "https://example.com/metadata.json";
    const assetKey = "Asset_" + Date.now();
    const collection = "Collection_" + Date.now();

    try {
        console.log(`1. Finding or Creating User for wallet: ${walletAddress}`)

        let user = await prisma.user.findFirst({
            where: {
                wallets: {
                    some: { walletAddress: walletAddress }
                }
            }
        });

        if (!user) {
            console.log('User not found, creating new user...')
            user = await prisma.user.create({
                data: {
                    wallets: {
                        create: {
                            walletAddress: walletAddress,
                            walletType: 'solana'
                        }
                    }
                }
            });
            console.log('User created:', user.id)
        } else {
            console.log('User found:', user.id)
        }

        console.log('2. Finding Wallet ID...')
        const wallet = await prisma.wallet.findUnique({ where: { walletAddress: walletAddress } });

        if (wallet) {
            console.log('Wallet found:', wallet.id)
            console.log('3. Creating NFT record...')

            const nft = await prisma.nft.create({
                data: {
                    nftId: assetKey,
                    name: name,
                    metadataUri: uri,
                    walletId: wallet.id,
                }
            });
            console.log('NFT created successfully:', nft.id)
        } else {
            console.error('CRITICAL: Wallet not found even after user creation!')
        }

    } catch (e) {
        console.error('FAILED to execute DB operations:', e)
    } finally {
        await prisma.$disconnect()
    }
}

main()
