import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { prisma } from "../index.js";
import { emitConversationRead, emitDirectMessage, emitMessageRequestResolved } from "../socket.js";
import { directMessageAccessError, getDirectMessageAccess } from "../lib/direct-message-access.js";

const getConversationPeerId = async (conversationId: string, userId: string) => {
    const participants = await prisma.conversationParticipant.findMany({
        where: { conversationId },
        select: { userId: true },
    });
    if (!participants.some((participant) => participant.userId === userId)) return null;
    const peer = participants.find((participant) => participant.userId !== userId);
    return peer?.userId || null;
};

// ==========================================
// 1. GET OR CREATE CONVERSATION (IDEMPOTENT & BLOCK ENFORCED)
// ==========================================
export const getOrCreateConversation = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const { recipientId } = req.body;

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (!recipientId || typeof recipientId !== "string" || recipientId === userId) {
            return res.status(400).json({ error: "Valid recipient user ID is required" });
        }

        // Verify that the recipient user exists
        const recipientUser = await prisma.user.findUnique({
            where: { id: recipientId },
            select: { id: true, username: true },
        });

        if (!recipientUser) {
            return res.status(404).json({ error: "Recipient user not found" });
        }

        const access = await getDirectMessageAccess(userId, recipientId);
        if (!access.allowed) {
            return res.status(403).json({ error: directMessageAccessError(access) });
        }

        // Check for existing conversation with both participants (idempotent lookup)
        const directKey = [userId, recipientId].sort().join(":");
        const existingConversation = await prisma.conversation.findFirst({
            where: {
                OR: [
                    { directKey },
                    { AND: [
                    { participants: { some: { userId } } },
                    { participants: { some: { userId: recipientId } } },
                    ] },
                ],
            },
            include: {
                participants: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                username: true,
                                avatarUrl: true,
                                isVerified: true,
                            },
                        },
                    },
                },
                messages: {
                    take: 1,
                    orderBy: { createdAt: "desc" },
                },
            },
        });

        if (existingConversation) {
            return res.status(200).json({ conversation: existingConversation });
        }

        // Create new conversation with initial read state
        const newConversation = await prisma.conversation.create({
            data: {
                directKey,
                status: access.otherFollowsUser ? "ACTIVE" : "PENDING",
                requestedById: access.otherFollowsUser ? null : userId,
                participants: {
                    create: [
                        { userId, hasReadLatest: true },
                        { userId: recipientId, hasReadLatest: true },
                    ],
                },
            },
            include: {
                participants: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                username: true,
                                avatarUrl: true,
                                isVerified: true,
                            },
                        },
                    },
                },
                messages: true,
            },
        });

        return res.status(201).json({ conversation: newConversation });
    } catch (error) {
        if ((error as { code?: string }).code === "P2002") {
            const [userId, recipientId] = [req.user?.userId, req.body?.recipientId];
            if (userId && typeof recipientId === "string") {
                const directKey = [userId, recipientId].sort().join(":");
                const conversation = await prisma.conversation.findUnique({
                    where: { directKey },
                    include: { participants: { include: { user: { select: { id: true, name: true, username: true, avatarUrl: true, isVerified: true } } } }, messages: { take: 1, orderBy: { createdAt: "desc" } } },
                }).catch(() => null);
                if (conversation) return res.status(200).json({ conversation });
            }
        }
        console.error("Error in getOrCreateConversation:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 2. GET USER CONVERSATIONS (WITH UNREAD AUDIT)
// ==========================================
export const getConversations = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const archived = req.query.archived === "true";
        const conversations = await prisma.conversation.findMany({
            where: {
                participants: {
                    some: { userId, archivedAt: archived ? { not: null } : null },
                },
                OR: [
                    { status: "ACTIVE" },
                    { status: "PENDING", requestedById: userId },
                ],
            },
            orderBy: { updatedAt: "desc" },
            include: {
                participants: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                username: true,
                                avatarUrl: true,
                                isVerified: true,
                            },
                        },
                    },
                },
                messages: {
                    take: 1,
                    orderBy: { createdAt: "desc" },
                    include: {
                        sender: {
                            select: {
                                id: true,
                                username: true,
                                avatarUrl: true,
                                isVerified: true,
                            },
                        },
                    },
                },
            },
        });

        const eligibleConversations = (await Promise.all(conversations.map(async (conversation) => {
            const otherParticipant = conversation.participants.find((participant) => participant.userId !== userId);
            if (!otherParticipant) return null;
            const access = await getDirectMessageAccess(userId, otherParticipant.userId);
            return access.allowed ? conversation : null;
        }))).filter((conversation): conversation is typeof conversations[number] => conversation !== null);

        const formatted = await Promise.all(eligibleConversations.map(async (conv) => {
            const myParticipant = conv.participants.find((p) => p.userId === userId);
            const otherParticipant = conv.participants.find((p) => p.userId !== userId);
            const unreadCount = myParticipant ? await prisma.message.count({
                where: {
                    conversationId: conv.id,
                    senderId: { not: userId },
                    createdAt: { gt: myParticipant.lastReadAt || myParticipant.joinedAt },
                },
            }) : 0;
            return {
                ...conv,
                hasUnread: unreadCount > 0,
                unreadCount,
                otherUser: otherParticipant?.user || null,
            };
        }));

        const totalUnreadCount = formatted.filter((c) => c.hasUnread).length;

        return res.status(200).json({
            conversations: formatted,
            totalUnreadCount,
        });
    } catch (error) {
        console.error("Error in getConversations:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

export const getEligibleContacts = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
        const type = req.query.type === "following" ? "following" : "followers";
        const users = await prisma.user.findMany({
            where: {
                id: { not: userId },
                ...(type === "followers"
                    ? { following: { some: { followingId: userId } } }
                    : { followers: { some: { followerId: userId } } }),
                ...(query ? { OR: [
                    { username: { contains: query, mode: "insensitive" as const } },
                    { name: { contains: query, mode: "insensitive" as const } },
                ] } : {}),
            },
            orderBy: { name: "asc" },
            take: 100,
            select: { id: true, name: true, username: true, avatarUrl: true, isVerified: true },
        });
        const contacts = await Promise.all(users.map(async (contact) => {
            const access = await getDirectMessageAccess(userId, contact.id);
            if (!access.allowed) return null;
            const conversation = await prisma.conversation.findFirst({
                where: { AND: [
                    { participants: { some: { userId } } },
                    { participants: { some: { userId: contact.id } } },
                ] },
                select: { id: true, status: true, requestedById: true },
            });
            return { ...contact, conversationId: conversation?.id || null, conversationStatus: conversation?.status || null, requestedById: conversation?.requestedById || null };
        }));
        return res.json({ contacts: contacts.filter((contact): contact is NonNullable<typeof contact> => contact !== null), type });
    } catch (error) {
        console.error("Error fetching eligible direct-message contacts:", error);
        return res.status(500).json({ error: "Unable to load eligible contacts." });
    }
};

export const getMessageRequests = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        const requests = await prisma.conversation.findMany({
            where: {
                status: "PENDING",
                requestedById: { not: userId },
                participants: { some: { userId, archivedAt: null } },
                messages: { some: {} },
            },
            orderBy: { updatedAt: "desc" },
            include: {
                participants: { include: { user: { select: { id: true, name: true, username: true, avatarUrl: true, isVerified: true } } } },
                messages: { take: 1, orderBy: { createdAt: "desc" }, include: { sender: { select: { id: true, username: true, avatarUrl: true, isVerified: true } } } },
            },
        });
        const visibleRequests = (await Promise.all(requests.map(async (conversation) => {
            const requester = conversation.participants.find((participant) => participant.userId === conversation.requestedById);
            if (!requester) return null;
            const access = await getDirectMessageAccess(userId, requester.userId);
            if (!access.allowed) return null;
            const participant = conversation.participants.find((item) => item.userId === userId);
            const unreadCount = participant ? await prisma.message.count({
                where: { conversationId: conversation.id, senderId: requester.userId, createdAt: { gt: participant.lastReadAt || participant.joinedAt } },
            }) : 0;
            const other = conversation.participants.find((item) => item.userId !== userId)?.user || null;
            return { ...conversation, otherUser: other, unreadCount, hasUnread: unreadCount > 0 };
        }))).filter((conversation): conversation is NonNullable<typeof conversation> => conversation !== null);
        return res.json({ requests: visibleRequests });
    } catch (error) {
        console.error("Error fetching direct-message requests:", error);
        return res.status(500).json({ error: "Unable to load message requests." });
    }
};

export const respondToMessageRequest = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const conversationId = req.params.conversationId as string;
        const accept = req.body?.accept;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        if (typeof accept !== "boolean") return res.status(400).json({ error: "Accept must be true or false." });
        const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            select: { id: true, status: true, requestedById: true, participants: { select: { userId: true } } },
        });
        if (!conversation || !conversation.participants.some((participant) => participant.userId === userId)) {
            return res.status(404).json({ error: "Message request not found." });
        }
        if (conversation.status !== "PENDING" || conversation.requestedById === userId) {
            return res.status(409).json({ error: "This message request is no longer pending." });
        }
        const requesterId = conversation.requestedById;
        if (!requesterId) return res.status(409).json({ error: "This message request is invalid." });
        const access = await getDirectMessageAccess(userId, requesterId);
        if (!access.allowed) return res.status(403).json({ error: directMessageAccessError(access) });
        if (!accept) {
            await prisma.conversation.delete({ where: { id: conversationId } });
            emitMessageRequestResolved(conversationId, requesterId, false);
            return res.json({ conversationId, accepted: false });
        }
        const updated = await prisma.conversation.update({
            where: { id: conversationId },
            data: { status: "ACTIVE", requestedById: null },
            include: { participants: { include: { user: { select: { id: true, name: true, username: true, avatarUrl: true, isVerified: true } } } }, messages: { take: 1, orderBy: { createdAt: "desc" } } },
        });
        emitMessageRequestResolved(conversationId, requesterId, true);
        return res.json({ conversation: updated, accepted: true });
    } catch (error) {
        console.error("Error responding to direct-message request:", error);
        return res.status(500).json({ error: "Unable to update message request." });
    }
};

export const archiveConversation = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const conversationId = req.params.conversationId as string;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        const peerId = await getConversationPeerId(conversationId, userId);
        if (!peerId) return res.status(404).json({ error: "Conversation not found." });
        const access = await getDirectMessageAccess(userId, peerId);
        if (!access.allowed) return res.status(403).json({ error: directMessageAccessError(access) });
        const archived = req.body?.archived;
        if (typeof archived !== "boolean") return res.status(400).json({ error: "Archived must be true or false." });
        const participant = await prisma.conversationParticipant.update({
            where: { conversationId_userId: { conversationId, userId } },
            data: { archivedAt: archived ? new Date() : null },
            select: { conversationId: true, archivedAt: true },
        });
        return res.json({ conversationId: participant.conversationId, archived: Boolean(participant.archivedAt) });
    } catch (error) {
        console.error("Error archiving direct-message conversation:", error);
        return res.status(500).json({ error: "Unable to update archived conversation." });
    }
};

// ==========================================
// 3. GET MESSAGES IN CONVERSATION (AUTHORIZATION & READ RECEIPT)
// ==========================================
export const getMessages = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const conversationId = req.params.conversationId as string;

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (!conversationId) {
            return res.status(400).json({ error: "Conversation ID is required" });
        }

        // Verify conversation existence
        const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            select: { id: true },
        });

        if (!conversation) {
            return res.status(404).json({ error: "Conversation not found" });
        }

        // Ensure requesting user is a legitimate participant
        const peerId = await getConversationPeerId(conversationId, userId);
        if (!peerId) {
            return res.status(403).json({ error: "Not authorized to access this conversation" });
        }

        const access = await getDirectMessageAccess(userId, peerId);
        if (!access.allowed) return res.status(403).json({ error: directMessageAccessError(access) });

        // Mark as read for this participant
        const readAt = new Date();
        await prisma.conversationParticipant.update({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId,
                },
            },
            data: { hasReadLatest: true, lastReadAt: readAt },
        });
        emitConversationRead(conversationId, userId, readAt);

        const messages = await prisma.message.findMany({
            where: { conversationId },
            orderBy: { createdAt: "asc" },
            include: {
                sender: {
                    select: {
                        id: true,
                        username: true,
                        avatarUrl: true,
                        isVerified: true,
                    },
                },
            },
        });

        return res.status(200).json({ messages });
    } catch (error) {
        console.error("Error in getMessages:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 4. SEND DIRECT MESSAGE (PERSIST FIRST, BROADCAST SECOND)
// ==========================================
export const sendMessage = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const conversationId = req.params.conversationId as string;
        const { content, mediaUrl } = req.body;

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (!conversationId) {
            return res.status(400).json({ error: "Conversation ID is required" });
        }

        if (!content || typeof content !== "string" || content.trim().length === 0) {
            return res.status(400).json({ error: "Message content cannot be empty" });
        }

        if (content.length > 10000) {
            return res.status(400).json({ error: "Message content cannot exceed 10,000 characters" });
        }

        if (mediaUrl !== undefined && mediaUrl !== null && typeof mediaUrl !== "string") {
            return res.status(400).json({ error: "Media URL must be a string or null" });
        }

        // Verify conversation existence
        const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            select: { id: true, status: true, requestedById: true },
        });

        if (!conversation) {
            return res.status(404).json({ error: "Conversation not found" });
        }

        // Check participation
        const participants = await prisma.conversationParticipant.findMany({ where: { conversationId } });
        const userParticipant = participants.find((p) => p.userId === userId);
        const recipient = participants.find((p) => p.userId !== userId);
        if (!userParticipant || !recipient) {
            return res.status(403).json({ error: "Not authorized to message in this conversation" });
        }
        const access = await getDirectMessageAccess(userId, recipient.userId);
        if (!access.allowed) return res.status(403).json({ error: directMessageAccessError(access) });
        if (conversation.status === "PENDING" && conversation.requestedById !== userId) {
            return res.status(403).json({ error: "Accept this message request before replying." });
        }

        // Persist message & update conversation timestamp
        const message = await prisma.message.create({
            data: {
                conversationId,
                senderId: userId,
                content: content.trim(),
                mediaUrl: mediaUrl?.trim() || null,
            },
            include: {
                sender: {
                    select: {
                        id: true,
                        username: true,
                        avatarUrl: true,
                        isVerified: true,
                    },
                },
            },
        });

        await prisma.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() },
        });

        // Mark unread for recipient participant
        if (recipient) {
            await prisma.conversationParticipant.update({
                where: {
                    conversationId_userId: {
                        conversationId,
                        userId: recipient.userId,
                    },
                },
                data: { hasReadLatest: false },
            });

            // Real-time WebSocket emission (delivered to conversation room and recipient's room)
            emitDirectMessage(conversationId, recipient.userId, message, conversation.status === "PENDING");
        }

        return res.status(201).json({ message });
    } catch (error) {
        console.error("Error in sendMessage:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 5. MARK CONVERSATION AS READ
// ==========================================
export const markConversationAsRead = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const conversationId = req.params.conversationId as string;

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (!conversationId) {
            return res.status(400).json({ error: "Conversation ID is required" });
        }

        const peerId = await getConversationPeerId(conversationId, userId);
        if (!peerId) {
            return res.status(403).json({ error: "Not a participant in this conversation" });
        }
        const access = await getDirectMessageAccess(userId, peerId);
        if (!access.allowed) return res.status(403).json({ error: directMessageAccessError(access) });

        const readAt = new Date();
        await prisma.conversationParticipant.update({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId,
                },
            },
            data: { hasReadLatest: true, lastReadAt: readAt },
        });
        emitConversationRead(conversationId, userId, readAt);

        return res.status(200).json({ message: "Conversation marked as read" });
    } catch (error) {
        console.error("Error in markConversationAsRead:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

