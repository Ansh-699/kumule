import { PrismaClient } from '@prisma/client'
import dotenv from 'dotenv'

dotenv.config()

const prisma = new PrismaClient()

async function main() {
    try {
        console.log('Connecting to database...')
        // Try to count users (should be 0 or more, but proves connection)
        const count = await prisma.user.count()
        console.log(`Successfully connected! Found ${count} users.`)

        // Create a dummy transaction to verify write access
        const tx = await prisma.transaction.create({
            data: {
                transactionId: 'test-connection-' + Date.now(),
                userId: 'test-user',
                amount: 0,
                transactionType: 'TEST',
                status: 'PENDING'
            }
        })
        console.log('Successfully created test transaction:', tx.transactionId)

        // Clean up
        await prisma.transaction.delete({
            where: { id: tx.id }
        })
        console.log('Successfully deleted test transaction.')

    } catch (e) {
        console.error('Database connection failed:', e)
        process.exit(1)
    } finally {
        await prisma.$disconnect()
    }
}

main()
