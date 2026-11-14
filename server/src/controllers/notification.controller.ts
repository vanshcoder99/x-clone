import type { Response } from "express";
import { prisma } from "../index.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { privateTweetNotificationWhere } from "../lib/privacy.js";

// ==========================================
// 1. GET USER NOTIFICATIONS
// ==========================================
export const getNotifications = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const limit = Math.min(Number(req.query.limit) || 20, 50);
        const offset = Math.max(Number(req.query.offset) || 0, 0);

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        let blockedUserIds: string[] = [];
        const blocks = await prisma.block.findMany({
            where: {
                OR: [{ blockerId: userId }, { blockedId: userId }],
            },
            select: { blockerId: true, blockedId: true },
        });
        blockedUserIds = blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId));

        const whereClause: any = {
            userId,
            ...(blockedUserIds.length > 0 ? { sourceUserId: { notIn: blockedUserIds } } : {}),
            AND: [privateTweetNotificationWhere(userId)],
        };

        const [notifications, totalCount, unreadCount] = await Promise.all([
            prisma.notification.findMany({
                where: whereClause,
                orderBy: { createdAt: "desc" },
                skip: offset,
                take: limit,
                include: {
                    sourceUser: {
                        select: {
                            id: true,
                            username: true,
                            avatarUrl: true,
                            isVerified: true,
                        },
                    },
                    tweet: {
                        select: {
                            id: true,
                            content: true,
                        },
                    },
                },
            }),
            prisma.notification.count({ where: whereClause }),
            prisma.notification.count({ where: { ...whereClause, read: false } }),
        ]);

        return res.status(200).json({
            notifications,
            unreadCount,
            pagination: {
                offset,
                limit,
                totalCount,
                hasMore: offset + limit < totalCount,
            },
        });
    } catch (error) {
        console.error("Error in getNotifications:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 2. MARK NOTIFICATIONS AS READ
// ==========================================
export const markNotificationsRead = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const { notificationId } = req.body || {};

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (notificationId) {
            const notif = await prisma.notification.findUnique({
                where: { id: notificationId },
                select: { id: true, userId: true },
            });

            if (!notif) {
                return res.status(404).json({ error: "Notification not found" });
            }

            if (notif.userId !== userId) {
                return res.status(403).json({ error: "You are not authorized to modify this notification" });
            }

            await prisma.notification.update({
                where: { id: notificationId },
                data: { read: true },
            });
        } else {
            await prisma.notification.updateMany({
                where: { userId, read: false },
                data: { read: true },
            });
        }

        return res.status(200).json({ message: "Notifications marked as read" });
    } catch (error) {
        console.error("Error in markNotificationsRead:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};
