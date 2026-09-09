import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {PrismaPg} from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client.js'

dotenv.config({
    path: "./.env"
});

const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL
})

export const prisma = new PrismaClient({
  adapter,
});

const app = express();

app.use(cors());
app.use(express.json());


// app.get('/health', (req, res) => {
//   res.json({ status: 'ok' });
// });



const PORT = process.env.PORT || 5000;
app.listen(PORT,() => {
    console.log(`Server running on port ${PORT}`)
})