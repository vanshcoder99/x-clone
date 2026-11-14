import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import cookieParser from 'cookie-parser';
import { initSocket } from './socket.js';
import { uploadDirectory } from './lib/upload.js';

import authRouter from './routes/auth.routes.js';
import userRouter from './routes/user.routes.js';
import tweetRouter from './routes/tweet.routes.js';
import aiRouter from './routes/ai.routes.js';
import notificationRouter from './routes/notification.routes.js';
import messageRouter from './routes/message.routes.js';
import mediaRouter from './routes/media.routes.js';
import billingRouter from './routes/billing.routes.js';
import razorpayWebhookRouter from './routes/razorpay-webhook.routes.js';

// Load a server-local .env first, then fall back to the workspace root .env.
// Existing process variables take precedence in both cases.
const serverDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: [resolve(serverDirectory, '../.env'), resolve(serverDirectory, '../../.env')] });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error("DATABASE_URL is missing in environment variables");
}

const adapter = new PrismaPg({
    connectionString,
});

export const prisma = new PrismaClient({
    adapter,
});

const app = express();

app.use(
    cors({
        origin: process.env.CLIENT_URL?.replace(/\/$/, "") || "http://localhost:5173",
        credentials: true, // Allows HTTP-only cookies to pass through CORS
    })
);

// Razorpay signatures are calculated over the exact raw bytes. Mount before JSON parsing.
app.use("/api/billing/webhooks", express.raw({ type: "application/json", limit: "1mb" }), razorpayWebhookRouter);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Mount API Routers
app.use("/api/auth", authRouter);
app.use("/api/users", userRouter);
app.use("/api/tweets", tweetRouter);
app.use("/api/ai", aiRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/messages", messageRouter);
app.use("/api/media", mediaRouter);
app.use("/api/billing", billingRouter);

// Statically serve uploaded media assets with proper caching headers
app.use("/uploads", express.static(uploadDirectory, { maxAge: "7d" }));

app.get("/health", (_req, res) => {
    res.json({ status: "ok", app: "SocialSphere API", timestamp: new Date().toISOString() });
});

// 404 Handler for undefined API routes
app.use(/^\/api\/.*/, (_req, res) => {
    res.status(404).json({ error: "API endpoint not found" });
});

// Centralized error handling middleware
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.name === "MulterError") {
        const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        const message = err.code === "LIMIT_FILE_SIZE"
            ? "Uploaded file exceeds the 50MB limit."
            : err.code === "LIMIT_UNEXPECTED_FILE"
                ? "Upload one media file at a time."
                : "Media upload was rejected.";
        return res.status(status).json({ error: message });
    }
    if (err?.message?.startsWith("Unsupported media format")) {
        return res.status(400).json({ error: err.message });
    }
    if (err.type === "entity.too.large") {
        return res.status(413).json({ error: "Payload too large. Maximum size is 10MB." });
    }
    if (err instanceof SyntaxError && "body" in err) {
        return res.status(400).json({ error: "Invalid JSON payload" });
    }
    console.error("Unhandled error:", err);
    return res.status(err.status || 500).json({
        error: process.env.NODE_ENV === "production" ? "Internal server error" : (err.message || "Internal server error"),
    });
});

// Create HTTP server and initialize Socket.IO
export const httpServer = http.createServer(app);
export const io = initSocket(httpServer);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
const shutdown = async () => {
    console.log("Shutting down SocialSphere server gracefully...");
    if (io) {
        io.close();
    }
    httpServer.close(async () => {
        await prisma.$disconnect();
        console.log("SocialSphere server closed.");
        process.exit(0);
    });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
