import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('🌱 Starting database seed...')

    // Create users with wallets
    const user1 = await prisma.user.create({
        data: {
            wallets: {
                create: {
                    walletAddress: 'DemoWallet1ABC123XYZ456789',
                    walletType: 'SOLANA'
                }
            }
        },
        include: { wallets: true }
    })

    const user2 = await prisma.user.create({
        data: {
            wallets: {
                create: {
                    walletAddress: 'DemoWallet2DEF456UVW789012',
                    walletType: 'SOLANA'
                }
            }
        },
        include: { wallets: true }
    })

    const user3 = await prisma.user.create({
        data: {
            wallets: {
                create: {
                    walletAddress: 'DemoWallet3GHI789RST345678',
                    walletType: 'SOLANA'
                }
            }
        },
        include: { wallets: true }
    })

    console.log('✅ Created 3 users with wallets')

    // Create reward NFTs
    await prisma.rewardNft.createMany({
        data: [
            {
                name: 'Gold Achievement Badge',
                description: 'Exclusive gold badge for top performers',
                imageUrl: 'https://via.placeholder.com/400x400/FFD700/000000?text=Gold+NFT',
                metadataUri: 'https://example.com/metadata/gold-badge.json',
                nftAsset: 'GoldNFT1ABC123XYZ456789',
                adminWallet: 'AdminWallet1ABC123XYZ456789',
                requiredPoints: 100,
                totalSupply: 10,
                claimedCount: 3,
                isActive: true
            },
            {
                name: 'Silver Star Collectible',
                description: 'Silver star for dedicated users',
                imageUrl: 'https://via.placeholder.com/400x400/C0C0C0/000000?text=Silver+NFT',
                metadataUri: 'https://example.com/metadata/silver-star.json',
                nftAsset: 'SilverNFT2DEF456UVW789012',
                adminWallet: 'AdminWallet1ABC123XYZ456789',
                requiredPoints: 50,
                totalSupply: 20,
                claimedCount: 8,
                isActive: true
            },
            {
                name: 'Bronze Starter Pack',
                description: 'Bronze NFT for new members',
                imageUrl: 'https://via.placeholder.com/400x400/CD7F32/000000?text=Bronze+NFT',
                metadataUri: 'https://example.com/metadata/bronze-pack.json',
                nftAsset: 'BronzeNFT3GHI789RST345678',
                adminWallet: 'AdminWallet1ABC123XYZ456789',
                requiredPoints: 25,
                totalSupply: 50,
                claimedCount: 15,
                isActive: true
            }
        ]
    })

    console.log('✅ Created 3 reward NFTs')

    // Create reward account
    await prisma.rewardAccount.create({
        data: {
            userId: user1.id,
            walletAddress: user1.wallets[0].walletAddress,
            interactionCount: 75,
            claimedNfts: 2
        }
    })

    console.log('✅ Created reward account')

    // Create NFTs
    await prisma.nft.createMany({
        data: [
            {
                walletId: user1.wallets[0].id,
                nftId: 'NFT1ABC123',
                name: 'Cool Monkey #1',
                metadataUri: 'https://example.com/nft/monkey1.json',
                mintTimestamp: new Date()
            },
            {
                walletId: user2.wallets[0].id,
                nftId: 'NFT2DEF456',
                name: 'Cyber Cat #42',
                metadataUri: 'https://example.com/nft/cat42.json',
                mintTimestamp: new Date()
            },
            {
                walletId: user3.wallets[0].id,
                nftId: 'NFT3GHI789',
                name: 'Space Doge #99',
                metadataUri: 'https://example.com/nft/doge99.json',
                mintTimestamp: new Date()
            }
        ]
    })

    console.log('✅ Created 3 NFTs')

    // Create transactions
    const nfts = await prisma.nft.findMany()

    await prisma.transaction.createMany({
        data: [
            {
                userId: user1.id,
                nftId: nfts[0].id,
                transactionId: 'TX1ABC123',
                transactionType: 'MINT',
                walletAddress: user1.wallets[0].walletAddress,
                amount: 0,
                status: 'COMPLETED'
            },
            {
                userId: user2.id,
                nftId: nfts[1].id,
                transactionId: 'TX2DEF456',
                transactionType: 'PURCHASE',
                walletAddress: user2.wallets[0].walletAddress,
                amount: 2.0,
                status: 'COMPLETED'
            },
            {
                userId: user3.id,
                nftId: nfts[2].id,
                transactionId: 'TX3GHI789',
                transactionType: 'LIST',
                walletAddress: user3.wallets[0].walletAddress,
                amount: 0.8,
                status: 'COMPLETED'
            }
        ]
    })

    console.log('✅ Created 3 transactions')

    // Create events
    const event1 = await prisma.event.create({
        data: {
            creatorId: user1.id,
            creatorWallet: user1.wallets[0].walletAddress,
            name: 'NFT Art Exhibition 2024',
            description: 'Join us for an exclusive NFT art showcase featuring top digital artists',
            entryFee: 0.5,
            eventDate: new Date('2024-12-20T18:00:00Z'),
            status: 'ACTIVE'
        }
    })

    const event2 = await prisma.event.create({
        data: {
            creatorId: user2.id,
            creatorWallet: user2.wallets[0].walletAddress,
            name: 'Crypto Gaming Tournament',
            description: 'Compete in blockchain games and win exclusive NFT prizes',
            entryFee: 1.0,
            eventDate: new Date('2024-12-25T20:00:00Z'),
            status: 'ACTIVE'
        }
    })

    console.log('✅ Created 2 events')

    // Create event entries
    await prisma.eventEntry.createMany({
        data: [
            {
                userId: user2.id,
                eventId: event1.id,
                walletAddress: user2.wallets[0].walletAddress,
                amount: 0.5,
                txHash: 'EVENTTX1ABC123',
                status: 'ACTIVE'
            },
            {
                userId: user3.id,
                eventId: event1.id,
                walletAddress: user3.wallets[0].walletAddress,
                amount: 0.5,
                txHash: 'EVENTTX2DEF456',
                status: 'ACTIVE'
            },
            {
                userId: user1.id,
                eventId: event2.id,
                walletAddress: user1.wallets[0].walletAddress,
                amount: 1.0,
                txHash: 'EVENTTX3GHI789',
                status: 'ACTIVE'
            }
        ]
    })

    console.log('✅ Created 3 event entries')

    // Create disputes
    await prisma.dispute.createMany({
        data: [
            {
                userId: user2.id,
                eventId: event1.id,
                walletAddress: user2.wallets[0].walletAddress,
                reason: 'Event was cancelled without notice',
                description: 'The event organizer cancelled the NFT Art Exhibition without any prior notification. I paid the entry fee and want a refund.',
                amount: 0.5,
                status: 'PENDING'
            },
            {
                userId: user3.id,
                eventId: event1.id,
                walletAddress: user3.wallets[0].walletAddress,
                reason: 'Event did not meet expectations',
                description: 'The event quality was much lower than advertised. Only 2 artists showed up instead of the promised 10.',
                amount: 0.5,
                status: 'APPROVED',
                resolvedAt: new Date()
            },
            {
                userId: user1.id,
                eventId: event2.id,
                walletAddress: user1.wallets[0].walletAddress,
                reason: 'Technical issues during event',
                description: 'The gaming tournament had severe lag issues and I was unable to participate properly.',
                amount: 1.0,
                status: 'REJECTED',
                resolvedAt: new Date()
            },
            {
                userId: user2.id,
                eventId: event2.id,
                walletAddress: user2.wallets[0].walletAddress,
                reason: 'Unfair judging',
                description: 'The tournament results were clearly biased. I request a review of the judging process.',
                amount: 1.0,
                status: 'PENDING'
            }
        ]
    })

    console.log('✅ Created 4 disputes')

    // Create reward drafts
    await prisma.rewardDraft.createMany({
        data: [
            {
                name: 'Diamond Trophy',
                description: 'Ultimate achievement trophy',
                imageUrl: 'https://via.placeholder.com/400x400/B9F2FF/000000?text=Diamond',
                requiredPoints: 200,
                isListed: false
            },
            {
                name: 'Platinum Medal',
                description: 'Rare platinum achievement',
                imageUrl: 'https://via.placeholder.com/400x400/E5E4E2/000000?text=Platinum',
                requiredPoints: 150,
                isListed: false
            }
        ]
    })

    console.log('✅ Created 2 reward drafts')

    console.log('🎉 Database seeding completed!')
    console.log('\n📊 Summary:')
    console.log('- 3 Users with wallets')
    console.log('- 3 Reward NFTs (Gold, Silver, Bronze)')
    console.log('- 1 Reward account')
    console.log('- 3 NFTs in marketplace')
    console.log('- 3 Transactions')
    console.log('- 2 Events')
    console.log('- 3 Event entries')
    console.log('- 4 Disputes (1 Approved, 1 Rejected, 2 Pending)')
    console.log('- 2 Reward drafts')
}

main()
    .catch((e) => {
        console.error('❌ Seed error:', e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
