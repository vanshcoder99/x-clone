import { defineConfig } from "prisma/config";
import "dotenv/config"
import dotenv from 'dotenv'

dotenv.config({path: "./.env"})

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL?.replace("-pooler", "");

if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing. Please set it in your environment.");
}
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl
  },
});
