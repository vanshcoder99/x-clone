import { emitNotificationToUser } from '../socket.js';
import type { Request, Response } from "express";
import { prisma } from "../index.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { getUserContentAccess } from "../lib/privacy.js";
import { getUserEntitlements } from "../lib/entitlements.js";

// ==========================================
// 1. GET USER PROFILE BY USERNAME
// ==========================================
export const getUserProfile = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const username = req.params.username as string;
        const currentUserId = req.user?.userId;

        if (!username) {
            return res.status(400).json({ error: "Username parameter is required" });
        }

        const user = await prisma.user.findUnique({
            where: { username },
            select: {
                id: true,
                name: true,
                username: true,
                bio: true,
                avatarUrl: true,
                isVerified: true,
                isPrivate: true,
                createdAt: true,
                _count: {
                    select: {
                        followers: true,
                        following: true,
                        tweets: true,
                    },
                },
            },
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const entitlements = await getUserEntitlements(user.id);

        let isFollowing = false;
        let isFollowRequested = false;
        let followRequestId: string | null = null;
        let isBlocked = false;
        let isBlockedBy = false;

        if (currentUserId && currentUserId !== user.id) {
            const [followRecord, requestRecord, blockRecord, blockedByRecord] = await Promise.all([
                prisma.follow.findUnique({
                    where: {
                        followerId_followingId: {
                            followerId: currentUserId,
                            followingId: user.id,
                        },
                    },
                }),
                prisma.followRequest.findUnique({
                    where: { requesterId_targetId: { requesterId: currentUserId, targetId: user.id } },
                    select: { id: true, status: true },
                }),
                prisma.block.findUnique({
                    where: {
                        blockerId_blockedId: {
                            blockerId: currentUserId,
                            blockedId: user.id,
                        },
                    },
                }),
                prisma.block.findUnique({
                    where: {
                        blockerId_blockedId: {
                            blockerId: user.id,
                            blockedId: currentUserId,
                        },
                    },
                }),
            ]);

            isFollowing = !!followRecord;
            isFollowRequested = requestRecord?.status === "PENDING";
            followRequestId = isFollowRequested ? requestRecord?.id ?? null : null;
            isBlocked = !!blockRecord;
            isBlockedBy = !!blockedByRecord;
        }

        return res.status(200).json({
            user: {
                ...user,
                isVerified: entitlements.verifiedBadge,
                subscription: { tier: entitlements.tier, status: entitlements.subscriptionStatus },
                isFollowing,
                isFollowRequested,
                followRequestId,
                canViewContent: (!user.isPrivate || currentUserId === user.id || isFollowing) && !isBlocked && !isBlockedBy,
                isBlocked,
                isBlockedBy,
            },
        });
    } catch (error) {
        console.error("Error in getUserProfile:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 2. UPDATE OWN PROFILE (BIO, AVATAR, USERNAME)
// ==========================================
export const updateUserProfile = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const currentUserId = req.user?.userId;
        const { name, bio, avatarUrl, username, isPrivate } = req.body;

        if (!currentUserId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const dataToUpdate: { name?: string; bio?: string | null; avatarUrl?: string | null; username?: string; isPrivate?: boolean } = {};

        if (name !== undefined) {
            if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 80) {
                return res.status(400).json({ error: "Name must be between 1 and 80 characters" });
            }
            dataToUpdate.name = name.trim();
        }

        if (isPrivate !== undefined) {
            if (typeof isPrivate !== "boolean") {
                return res.status(400).json({ error: "Account privacy must be a boolean" });
            }
            dataToUpdate.isPrivate = isPrivate;
        }

        if (username !== undefined) {
            if (typeof username !== "string" || !/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
                return res.status(400).json({
                    error: "Username must be 3-30 characters and contain only alphanumeric characters and underscores",
                });
            }
            const existing = await prisma.user.findUnique({
                where: { username },
            });
            if (existing && existing.id !== currentUserId) {
                return res.status(409).json({ error: "Username already taken" });
            }
            dataToUpdate.username = username;
        }

        if (bio !== undefined) {
            if (bio !== null && typeof bio !== "string") {
                return res.status(400).json({ error: "Bio must be a string or null" });
            }
            if (typeof bio === "string" && bio.length > 160) {
                return res.status(400).json({ error: "Bio cannot exceed 160 characters" });
            }
            dataToUpdate.bio = bio;
        }

        if (avatarUrl !== undefined) {
            if (avatarUrl !== null && typeof avatarUrl !== "string") {
                return res.status(400).json({ error: "Avatar URL must be a string or null" });
            }
            if (typeof avatarUrl === "string" && avatarUrl.length > 2048) {
                return res.status(400).json({ error: "Avatar URL is too long" });
            }
            dataToUpdate.avatarUrl = typeof avatarUrl === "string" && avatarUrl.trim() === "" ? null : avatarUrl;
        }

        const updatedUser = await prisma.$transaction(async (tx) => {
            const updated = await tx.user.update({
                where: { id: currentUserId },
                data: dataToUpdate,
                select: {
                id: true,
                name: true,
                email: true,
                username: true,
                bio: true,
                avatarUrl: true,
                isVerified: true,
                isPrivate: true,
                createdAt: true,
                },
            });
            if (isPrivate === false) {
                await tx.followRequest.updateMany({
                    where: { targetId: currentUserId, status: "PENDING" },
                    data: { status: "CANCELED" },
                });
                await tx.notification.deleteMany({
                    where: { userId: currentUserId, type: "FOLLOW_REQUEST" },
                });
            }
            return updated;
        });

        return res.status(200).json({
            message: "Profile updated successfully",
            user: updatedUser,
        });
    } catch (error) {
        console.error("Error in updateUserProfile:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 3. FOLLOW USER
// ==========================================
export const followUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const currentUserId = req.user?.userId;
        const targetUserId = req.params.targetUserId as string;

        if (!currentUserId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (!targetUserId || currentUserId === targetUserId) {
            return res.status(400).json({ error: "Cannot follow yourself or missing target" });
        }

        const targetUser = await prisma.user.findUnique({
            where: { id: targetUserId },
            select: { id: true, isPrivate: true },
        });

        if (!targetUser) {
            return res.status(404).json({ error: "User not found" });
        }

        const blockExists = await prisma.block.findFirst({
            where: {
                OR: [
                    { blockerId: currentUserId, blockedId: targetUserId },
                    { blockerId: targetUserId, blockedId: currentUserId },
                ],
            },
        });

        if (blockExists) {
            return res.status(403).json({ error: "Cannot follow a blocked user" });
        }

        const alreadyFollowing = await prisma.follow.findUnique({
            where: {
                followerId_followingId: {
                    followerId: currentUserId,
                    followingId: targetUserId,
                },
            },
        });

        if (alreadyFollowing) {
            return res.status(200).json({
                message: "Already following this user",
                isFollowing: true,
            });
        }

        if (targetUser.isPrivate) {
            const existingRequest = await prisma.followRequest.findUnique({
                where: { requesterId_targetId: { requesterId: currentUserId, targetId: targetUserId } },
            });
            if (existingRequest?.status === "PENDING") {
                return res.status(200).json({ message: "Follow request is pending", isFollowing: false, isRequested: true, followRequestId: existingRequest.id });
            }
            const request = await prisma.$transaction(async (tx) => {
                await tx.notification.deleteMany({
                    where: { userId: targetUserId, sourceUserId: currentUserId, type: "FOLLOW_REQUEST" },
                });
                const created = await tx.followRequest.upsert({
                    where: { requesterId_targetId: { requesterId: currentUserId, targetId: targetUserId } },
                    create: { requesterId: currentUserId, targetId: targetUserId },
                    update: { status: "PENDING", createdAt: new Date() },
                });
                const notification = await tx.notification.create({
                    data: { userId: targetUserId, sourceUserId: currentUserId, type: "FOLLOW_REQUEST" },
                });
                return { created, notification };
            });
            emitNotificationToUser(targetUserId, {
                ...request.notification,
                sourceUser: { id: currentUserId, username: req.user?.username },
            });
            return res.status(200).json({ message: "Follow request sent", isFollowing: false, isRequested: true, followRequestId: request.created.id });
        }

        const [, newNotif] = await prisma.$transaction([
            prisma.followRequest.updateMany({
                where: { requesterId: currentUserId, targetId: targetUserId, status: "PENDING" },
                data: { status: "CANCELED" },
            }),
            prisma.follow.create({
                data: {
                    followerId: currentUserId,
                    followingId: targetUserId,
                },
            }),
            prisma.notification.create({
                data: {
                    userId: targetUserId,
                    sourceUserId: currentUserId,
                    type: "FOLLOW",
                },
            }),
        ]);

        emitNotificationToUser(targetUserId, { ...newNotif, sourceUser: { id: currentUserId, username: req.user?.username } });
        return res.status(200).json({ message: "Followed successfully", isFollowing: true, isRequested: false });
    } catch (error) {
        console.error("Error in followUser:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 4. UNFOLLOW USER
// ==========================================
export const unfollowUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const currentUserId = req.user?.userId;
        const targetUserId = req.params.targetUserId as string;

        if (!currentUserId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (!targetUserId) {
            return res.status(400).json({ error: "Target user ID required" });
        }

        await prisma.follow.deleteMany({
            where: {
                followerId: currentUserId,
                followingId: targetUserId,
            },
        });

        return res.status(200).json({ message: "Unfollowed successfully", isFollowing: false });
    } catch (error) {
        console.error("Error in unfollowUser:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 5. BLOCK USER (ATOMIC TRANSACTION)
// ==========================================
export const blockUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const currentUserId = req.user?.userId;
        const targetUserId = req.params.targetUserId as string;

        if (!currentUserId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (!targetUserId || currentUserId === targetUserId) {
            return res.status(400).json({ error: "Cannot block yourself or missing target" });
        }

        const targetUser = await prisma.user.findUnique({
            where: { id: targetUserId },
            select: { id: true },
        });

        if (!targetUser) {
            return res.status(404).json({ error: "User not found" });
        }

        await prisma.$transaction([
            prisma.follow.deleteMany({
                where: {
                    followerId: currentUserId,
                    followingId: targetUserId,
                },
            }),
            prisma.follow.deleteMany({
                where: {
                    followerId: targetUserId,
                    followingId: currentUserId,
                },
            }),
            prisma.block.upsert({
                where: {
                    blockerId_blockedId: {
                        blockerId: currentUserId,
                        blockedId: targetUserId,
                    },
                },
                create: {
                    blockerId: currentUserId,
                    blockedId: targetUserId,
                },
                update: {},
            }),
            prisma.followRequest.updateMany({
                where: {
                    status: "PENDING",
                    OR: [
                        { requesterId: currentUserId, targetId: targetUserId },
                        { requesterId: targetUserId, targetId: currentUserId },
                    ],
                },
                data: { status: "CANCELED" },
            }),
            prisma.notification.deleteMany({
                where: {
                    type: { in: ["FOLLOW_REQUEST", "FOLLOW_REQUEST_ACCEPTED", "FOLLOW_REQUEST_REJECTED"] },
                    OR: [
                        { userId: currentUserId, sourceUserId: targetUserId },
                        { userId: targetUserId, sourceUserId: currentUserId },
                    ],
                },
            }),
        ]);

        return res.status(200).json({ message: "User blocked successfully", isBlocked: true });
    } catch (error) {
        console.error("Error in blockUser:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 6. UNBLOCK USER
// ==========================================
export const unblockUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const currentUserId = req.user?.userId;
        const targetUserId = req.params.targetUserId as string;

        if (!currentUserId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (!targetUserId) {
            return res.status(400).json({ error: "Target user ID required" });
        }

        await prisma.block.deleteMany({
            where: {
                blockerId: currentUserId,
                blockedId: targetUserId,
            },
        });

        return res.status(200).json({ message: "User unblocked successfully", isBlocked: false });
    } catch (error) {
        console.error("Error in unblockUser:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 7. SEARCH USERS
// ==========================================
export const searchUsers = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const query = req.query.q as string;
        const currentUserId = req.user?.userId;
        const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 20);

        if (!query || query.trim() === "") {
            return res.status(200).json({ users: [] });
        }

        let blockedUserIds: string[] = [];
        if (currentUserId) {
            const blocks = await prisma.block.findMany({
                where: {
                    OR: [
                        { blockerId: currentUserId },
                        { blockedId: currentUserId },
                    ],
                },
                select: { blockerId: true, blockedId: true },
            });
            blockedUserIds = blocks.map((b) => (b.blockerId === currentUserId ? b.blockedId : b.blockerId));
        }

        const users = await prisma.user.findMany({
            where: {
                AND: [
                    {
                        OR: [
                            { username: { contains: query.trim(), mode: "insensitive" } },
                            { bio: { contains: query.trim(), mode: "insensitive" } },
                        ],
                    },
                    ...(blockedUserIds.length > 0 ? [{ id: { notIn: blockedUserIds } }] : []),
                ],
            },
            take: limit,
            select: {
                id: true,
                username: true,
                bio: true,
                avatarUrl: true,
                isVerified: true,
                isPrivate: true,
            },
        });

        return res.status(200).json({ users });
    } catch (error) {
        console.error("Error in searchUsers:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 7b. SUGGESTED USERS (WHO TO FOLLOW)
// ==========================================
export const getSuggestedUsers = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const currentUserId = req.user?.userId;
        const limit = Math.min(Math.max(Number(req.query.limit) || 3, 1), 10);

        let blockedUserIds: string[] = [];
        let followingIds: string[] = [];
        if (currentUserId) {
            const [blocks, following] = await Promise.all([
                prisma.block.findMany({
                    where: {
                        OR: [
                            { blockerId: currentUserId },
                            { blockedId: currentUserId },
                        ],
                    },
                    select: { blockerId: true, blockedId: true },
                }),
                prisma.follow.findMany({
                    where: { followerId: currentUserId },
                    select: { followingId: true },
                }),
            ]);
            blockedUserIds = blocks.map((b) => (b.blockerId === currentUserId ? b.blockedId : b.blockerId));
            followingIds = following.map((f) => f.followingId);
        }

        const excludedIds = Array.from(
            new Set([
                ...(currentUserId ? [currentUserId] : []),
                ...blockedUserIds,
                ...followingIds,
            ])
        );

        const [users, pendingRequests] = await Promise.all([prisma.user.findMany({
            where: {
                ...(excludedIds.length > 0 ? { id: { notIn: excludedIds } } : {}),
            },
            take: limit,
            select: {
                id: true,
                username: true,
                bio: true,
                avatarUrl: true,
                isVerified: true,
                isPrivate: true,
            },
            orderBy: { createdAt: "desc" },
        }),
        currentUserId
            ? prisma.followRequest.findMany({ where: { requesterId: currentUserId, status: "PENDING" }, select: { id: true, targetId: true } })
            : Promise.resolve([]),
        ]);

        const requestsByTarget = new Map(pendingRequests.map((request) => [request.targetId, request.id]));

        return res.status(200).json({ users: users.map((user) => ({
            ...user,
            isFollowRequested: requestsByTarget.has(user.id),
            followRequestId: requestsByTarget.get(user.id) || null,
        })) });
    } catch (error) {
        console.error("Error in getSuggestedUsers:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 9. GET FOLLOWERS LIST
// ==========================================
export const getFollowers = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const username = req.params.username as string;
        const currentUserId = req.user?.userId;

        if (!username) {
            return res.status(400).json({ error: "Username parameter required" });
        }

        const targetUser = await prisma.user.findUnique({
            where: { username },
            select: { id: true, isPrivate: true },
        });

        if (!targetUser) {
            return res.status(404).json({ error: "User not found" });
        }

        const contentAccess = await getUserContentAccess(currentUserId, targetUser.id);
        if (!contentAccess.allowed) return res.status(403).json({ error: "This account is private. Follow to view its connections." });

        if (currentUserId && currentUserId !== targetUser.id) {
            const block = await prisma.block.findFirst({
                where: {
                    OR: [
                        { blockerId: currentUserId, blockedId: targetUser.id },
                        { blockerId: targetUser.id, blockedId: currentUserId },
                    ],
                },
            });
            if (block) {
                return res.status(403).json({ error: "Access denied" });
            }
        }

        let blockedUserIds: string[] = [];
        if (currentUserId) {
            const blocks = await prisma.block.findMany({
                where: {
                    OR: [
                        { blockerId: currentUserId },
                        { blockedId: currentUserId },
                    ],
                },
                select: { blockerId: true, blockedId: true },
            });
            blockedUserIds = blocks.map((b) => (b.blockerId === currentUserId ? b.blockedId : b.blockerId));
        }

        const followers = await prisma.follow.findMany({
            where: {
                followingId: targetUser.id,
                ...(blockedUserIds.length > 0 ? { followerId: { notIn: blockedUserIds } } : {}),
            },
            include: {
                follower: {
                    select: {
                        id: true,
                        username: true,
                        bio: true,
                        avatarUrl: true,
                        isVerified: true,
                    },
                },
            },
        });

        return res.status(200).json({
            followers: followers.map((f) => f.follower),
        });
    } catch (error) {
        console.error("Error in getFollowers:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 10. GET FOLLOWING LIST
// ==========================================
export const getFollowing = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const username = req.params.username as string;
        const currentUserId = req.user?.userId;

        if (!username) {
            return res.status(400).json({ error: "Username parameter required" });
        }

        const targetUser = await prisma.user.findUnique({
            where: { username },
            select: { id: true, isPrivate: true },
        });

        if (!targetUser) {
            return res.status(404).json({ error: "User not found" });
        }

        const contentAccess = await getUserContentAccess(currentUserId, targetUser.id);
        if (!contentAccess.allowed) return res.status(403).json({ error: "This account is private. Follow to view its connections." });

        if (currentUserId && currentUserId !== targetUser.id) {
            const block = await prisma.block.findFirst({
                where: {
                    OR: [
                        { blockerId: currentUserId, blockedId: targetUser.id },
                        { blockerId: targetUser.id, blockedId: currentUserId },
                    ],
                },
            });
            if (block) {
                return res.status(403).json({ error: "Access denied" });
            }
        }

        let blockedUserIds: string[] = [];
        if (currentUserId) {
            const blocks = await prisma.block.findMany({
                where: {
                    OR: [
                        { blockerId: currentUserId },
                        { blockedId: currentUserId },
                    ],
                },
                select: { blockerId: true, blockedId: true },
            });
            blockedUserIds = blocks.map((b) => (b.blockerId === currentUserId ? b.blockedId : b.blockerId));
        }

        const following = await prisma.follow.findMany({
            where: {
                followerId: targetUser.id,
                ...(blockedUserIds.length > 0 ? { followingId: { notIn: blockedUserIds } } : {}),
            },
            include: {
                following: {
                    select: {
                        id: true,
                        username: true,
                        bio: true,
                        avatarUrl: true,
                        isVerified: true,
                    },
                },
            },
        });

        return res.status(200).json({
            following: following.map((f) => f.following),
        });
    } catch (error) {
        console.error("Error in getFollowing:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

export const getReceivedFollowRequests = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
        const requests = await prisma.followRequest.findMany({
            where: { targetId: userId, status: "PENDING" },
            orderBy: { createdAt: "asc" },
            include: { requester: { select: { id: true, username: true, name: true, avatarUrl: true, isVerified: true } } },
        });
        return res.status(200).json({ requests });
    } catch (error) {
        console.error("Error in getReceivedFollowRequests:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

export const getSentFollowRequests = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
        const requests = await prisma.followRequest.findMany({
            where: { requesterId: userId, status: "PENDING" },
            orderBy: { createdAt: "asc" },
            include: { target: { select: { id: true, username: true, name: true, avatarUrl: true, isVerified: true, isPrivate: true } } },
        });
        return res.status(200).json({ requests });
    } catch (error) {
        console.error("Error in getSentFollowRequests:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

const decideFollowRequest = async (
    req: AuthenticatedRequest,
    res: Response,
    decision: "ACCEPTED" | "REJECTED"
) => {
    const ownerId = req.user?.userId;
    const requestId = req.params.requestId as string;
    if (!ownerId) return res.status(401).json({ error: "Unauthorized" });
    if (!requestId) return res.status(400).json({ error: "Follow request ID is required" });

    try {
        const outcome = await prisma.$transaction(async (tx) => {
            const request = await tx.followRequest.findUnique({ where: { id: requestId } });
            if (!request || request.targetId !== ownerId) return { status: 404 as const };
            if (request.status !== "PENDING") return { status: 409 as const };

            const block = await tx.block.findFirst({
                where: { OR: [{ blockerId: ownerId, blockedId: request.requesterId }, { blockerId: request.requesterId, blockedId: ownerId }] },
                select: { id: true },
            });
            if (block) {
                await tx.followRequest.update({ where: { id: requestId }, data: { status: "CANCELED" } });
                await tx.notification.deleteMany({
                    where: { userId: ownerId, sourceUserId: request.requesterId, type: "FOLLOW_REQUEST" },
                });
                return { status: 403 as const };
            }

            const changed = await tx.followRequest.updateMany({
                where: { id: requestId, targetId: ownerId, status: "PENDING" },
                data: { status: decision },
            });
            if (changed.count !== 1) return { status: 409 as const };

            await tx.notification.deleteMany({
                where: { userId: ownerId, sourceUserId: request.requesterId, type: "FOLLOW_REQUEST" },
            });
            if (decision === "ACCEPTED") {
                await tx.follow.upsert({
                    where: { followerId_followingId: { followerId: request.requesterId, followingId: ownerId } },
                    create: { followerId: request.requesterId, followingId: ownerId },
                    update: {},
                });
            }
            const notification = await tx.notification.create({
                data: {
                    userId: request.requesterId,
                    sourceUserId: ownerId,
                    type: decision === "ACCEPTED" ? "FOLLOW_REQUEST_ACCEPTED" : "FOLLOW_REQUEST_REJECTED",
                },
            });
            return { status: 200 as const, requesterId: request.requesterId, notification };
        });

        if (outcome.status !== 200) {
            if (outcome.status === 404) return res.status(404).json({ error: "Pending follow request not found" });
            if (outcome.status === 403) return res.status(403).json({ error: "Follow request is no longer available because of a block" });
            return res.status(409).json({ error: "Follow request has already been handled" });
        }
        emitNotificationToUser(outcome.requesterId, {
            ...outcome.notification,
            sourceUser: { id: ownerId, username: req.user?.username },
        });
        return res.status(200).json({ message: decision === "ACCEPTED" ? "Follow request accepted" : "Follow request rejected" });
    } catch (error) {
        console.error("Error deciding follow request:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

export const acceptFollowRequest = (req: AuthenticatedRequest, res: Response) => decideFollowRequest(req, res, "ACCEPTED");
export const rejectFollowRequest = (req: AuthenticatedRequest, res: Response) => decideFollowRequest(req, res, "REJECTED");

export const cancelFollowRequest = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.userId;
    const requestId = req.params.requestId as string;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!requestId) return res.status(400).json({ error: "Follow request ID is required" });
    try {
        const request = await prisma.followRequest.findUnique({ where: { id: requestId } });
        if (!request || request.requesterId !== userId || request.status !== "PENDING") {
            return res.status(404).json({ error: "Pending follow request not found" });
        }
        const [cancelResult] = await prisma.$transaction([
            prisma.followRequest.updateMany({ where: { id: requestId, requesterId: userId, status: "PENDING" }, data: { status: "CANCELED" } }),
            prisma.notification.deleteMany({ where: { userId: request.targetId, sourceUserId: userId, type: "FOLLOW_REQUEST" } }),
        ]);
        if (cancelResult.count !== 1) return res.status(409).json({ error: "Follow request has already been handled" });
        return res.status(200).json({ message: "Follow request canceled" });
    } catch (error) {
        console.error("Error canceling follow request:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};
