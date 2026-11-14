import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";
import { verifyAccessToken } from "./lib/jwt.js";
import { prisma } from "./index.js";
import { directMessageAccessError, getDirectMessageAccess } from "./lib/direct-message-access.js";

let io: SocketIOServer | null = null;

export const initSocket = (httpServer: HttpServer): SocketIOServer => {
    io = new SocketIOServer(httpServer, {
        cors: {
            origin: process.env.CLIENT_URL || "http://localhost:5173",
            credentials: true,
        },
    });

    // Authentication Middleware for WebSocket handshakes
    io.use((socket, next) => {
        try {
            const token =
                socket.handshake.auth?.token ||
                socket.handshake.headers?.authorization?.replace("Bearer ", "");

            if (!token) {
                // Allow unauthenticated connection for public broadcasts (e.g. tweet:new)
                return next();
            }

            const payload = verifyAccessToken(token);
            socket.data.user = payload;
            next();
        } catch (err: any) {
            // Reject connections that pass an explicit invalid or expired token
            console.warn(`WebSocket handshake rejected: ${err?.message || "Invalid or expired token"}`);
            return next(new Error("Authentication error: Invalid or expired token"));
        }
    });

    io.on("connection", (socket) => {
        const user = socket.data?.user;

        // If authenticated user, join permitted personal room for targeted alerts & DMs
        if (user?.userId) {
            socket.join(`user_${user.userId}`);
            console.log(`🔌 Socket connected: user @${user.username} (${socket.id})`);
        } else {
            console.log(`🔌 Socket connected: anonymous (${socket.id})`);
        }

        // Allow authenticated user to authenticate late (e.g. after login)
        socket.on("authenticate", (token: string) => {
            try {
                if (!token || typeof token !== "string") {
                    socket.emit("auth_error", { message: "Token is required" });
                    return;
                }
                const payload = verifyAccessToken(token);
                // Leave any prior user rooms if re-authenticating as a different user
                for (const room of socket.rooms) {
                    if (room.startsWith("user_") && room !== `user_${payload.userId}`) {
                        socket.leave(room);
                    }
                }
                socket.data.user = payload;
                socket.join(`user_${payload.userId}`);
                console.log(`🔐 Socket authenticated: user @${payload.username} (${socket.id})`);
                socket.emit("authenticated", { userId: payload.userId, username: payload.username });
            } catch (err: any) {
                socket.emit("auth_error", { message: "Invalid or expired token" });
            }
        });

        // Join conversation room for real-time DM streaming (strictly authorized to participants only)
        socket.on("join_conversation", async (conversationId: string) => {
            const currentUserId = socket.data?.user?.userId;
            if (!currentUserId || !conversationId) {
                socket.emit("auth_error", { message: "Unauthorized: Please authenticate first" });
                return;
            }

            try {
                const participants = await prisma.conversationParticipant.findMany({
                    where: { conversationId },
                    select: { userId: true },
                });
                const participant = participants.some((entry) => entry.userId === currentUserId);
                const peer = participants.find((entry) => entry.userId !== currentUserId);

                if (participant && peer) {
                    const access = await getDirectMessageAccess(currentUserId, peer.userId);
                    if (!access.allowed) {
                        socket.emit("auth_error", { message: directMessageAccessError(access) });
                        return;
                    }
                    socket.join(`conv_${conversationId}`);
                    socket.emit("joined_conversation", { conversationId });
                } else {
                    socket.emit("auth_error", { message: "Unauthorized to join this conversation" });
                }
            } catch (err) {
                console.error("Error authorizing socket conversation room:", err);
                socket.emit("auth_error", { message: "Server error joining conversation" });
            }
        });

        // Leave conversation room
        socket.on("leave_conversation", (conversationId: string) => {
            if (conversationId) {
                socket.leave(`conv_${conversationId}`);
            }
        });

        // User typing indicator in conversation (strictly scoped to authorized room members)
        socket.on("typing", async ({ conversationId, isTyping }: { conversationId: string; isTyping: boolean }) => {
            const currentUserId = socket.data?.user?.userId;
            if (!currentUserId || !conversationId) return;

            // Only allow typing broadcasts if this socket has actually joined the conversation room
            if (!socket.rooms.has(`conv_${conversationId}`)) {
                return;
            }

            const participants = await prisma.conversationParticipant.findMany({
                where: { conversationId },
                select: { userId: true },
            });
            const peer = participants.find((entry) => entry.userId !== currentUserId);
            if (!peer || !(await getDirectMessageAccess(currentUserId, peer.userId)).allowed) {
                socket.leave(`conv_${conversationId}`);
                socket.emit("auth_error", { message: "A blocked account cannot access this chat" });
                return;
            }

            socket.to(`conv_${conversationId}`).emit("user_typing", {
                conversationId,
                userId: currentUserId,
                username: socket.data?.user?.username,
                isTyping: Boolean(isTyping),
            });
        });

        socket.on("disconnect", () => {
            // Cleanup automatically handled by Socket.IO
        });
    });

    return io;
};

// Emit real-time notification to a specific user
export const emitNotificationToUser = (userId: string, notification: any) => {
    if (io) {
        io.to(`user_${userId}`).emit("notification:new", notification);
    }
};

// Emit real-time direct message
export const emitDirectMessage = (conversationId: string, recipientUserId: string, message: any, isRequest = false) => {
    if (io) {
        // Emit to the conversation room (if both participants currently inside)
        io.to(`conv_${conversationId}`).emit("message:new", message);
        // Also emit directly to recipient's personal room for badge/toast updates
        io.to(`user_${recipientUserId}`).emit("message:unread", { conversationId, message });
        if (isRequest) io.to(`user_${recipientUserId}`).emit("message:request:new", { conversationId, message });
    }
};

export const emitMessageRequestResolved = (conversationId: string, requesterUserId: string, accepted: boolean) => {
    io?.to(`user_${requesterUserId}`).emit(accepted ? "message:request:accepted" : "message:request:deleted", { conversationId });
};

export const emitConversationRead = (conversationId: string, readerUserId: string, readAt: Date) => {
    io?.to(`conv_${conversationId}`).emit("conversation:read", {
        conversationId,
        readerUserId,
        readAt: readAt.toISOString(),
    });
};

// Broadcast new public tweet to global feed
export const broadcastNewTweet = (tweet: any) => {
    if (io) {
        io.emit("tweet:new", tweet);
    }
};

