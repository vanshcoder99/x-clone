import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
    const users = await prisma.user.findMany({
        select: { id: true, username: true, email: true },
        take: 10,
    });
    console.log("Current users in database:", users);
    await prisma.$disconnect();
}

main().catch(console.error);

