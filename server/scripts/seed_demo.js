import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function seedDemoUser() {
    const existing = await prisma.user.findFirst({
        where: {
            OR: [{ email: "demo@socialsphere.com" }, { username: "demo_user" }]
        }
    });

    const hashedPassword = await bcrypt.hash("DemoUser123!", 10);

    if (existing) {
        await prisma.user.update({
            where: { id: existing.id },
            data: { password: hashedPassword }
        });
        console.log("Demo user updated: demo_user / DemoUser123!");
    } else {
        await prisma.user.create({
            data: {
                username: "demo_user",
                email: "demo@socialsphere.com",
                password: hashedPassword,
                bio: "SocialSphere Enthusiast & Builder 🚀",
                isVerified: true,
            }
        });
        console.log("Demo user created: demo_user / DemoUser123!");
    }
    await prisma.$disconnect();
}

seedDemoUser().catch(console.error);

