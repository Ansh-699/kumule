import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('🌱 Adding disputes to database...')

    // Get existing users and events
    const users = await prisma.user.findMany({ include: { wallets: true } })
    const events = await prisma.event.findMany()

    if (users.length < 3 || events.length < 2) {
        console.error('❌ Not enough users or events in database. Please run the full seed first.')
        return
    }

    const user1 = users[0]
    const user2 = users[1]
    const user3 = users[2]
    const event1 = events[0]
    const event2 = events[1]

    // Create disputes
    await prisma.dispute.createMany({
        data: [
            {
                userId: user2.id,
                eventId: event1.id,
                walletAddress: user2.wallets[0].walletAddress,
                reason: 'Event was cancelled without notice. The event organizer cancelled the NFT Art Exhibition without any prior notification. I paid the entry fee and want a refund.',
                amount: 0.5,
                status: 'PENDING'
            },
            {
                userId: user3.id,
                eventId: event1.id,
                walletAddress: user3.wallets[0].walletAddress,
                reason: 'Event did not meet expectations. The event quality was much lower than advertised. Only 2 artists showed up instead of the promised 10.',
                amount: 0.5,
                status: 'APPROVED',
                resolvedAt: new Date()
            },
            {
                userId: user1.id,
                eventId: event2.id,
                walletAddress: user1.wallets[0].walletAddress,
                reason: 'Technical issues during event. The gaming tournament had severe lag issues and I was unable to participate properly.',
                amount: 1.0,
                status: 'REJECTED',
                resolvedAt: new Date()
            },
            {
                userId: user2.id,
                eventId: event2.id,
                walletAddress: user2.wallets[0].walletAddress,
                reason: 'Unfair judging. The tournament results were clearly biased. I request a review of the judging process.',
                amount: 1.0,
                status: 'PENDING'
            }
        ]
    })

    console.log('✅ Created 4 disputes')
    console.log('\n📊 Dispute Summary:')
    console.log('- 2 PENDING disputes')
    console.log('- 1 APPROVED dispute')
    console.log('- 1 REJECTED dispute')
    console.log('\n🎉 Disputes added successfully!')
}

main()
    .catch((e) => {
        console.error('❌ Error:', e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
