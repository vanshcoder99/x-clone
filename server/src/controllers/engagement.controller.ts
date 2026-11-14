import { emitNotificationToUser } from '../socket.js';
import type { Response } from "express";
import { prisma } from "../index.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { formatTweetMedia } from "./tweet.controller.js";
import { getUserContentAccess, visibleTweetWhere } from "../lib/privacy.js";
import { getUserEntitlements } from "../lib/entitlements.js";
import { countCharacters } from "../lib/plan-config.js";

// ==========================================
// 1. TOGGLE LIKE (IDEMPOTENT + NOTIFICATION)
// ==========================================
export const toggleLike = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const tweetId = req.params.tweetId as string;

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (!tweetId) {
            return res.status(400).json({ error: "Tweet ID is required" });
        }

        const tweet = await prisma.tweet.findUnique({
            where: { id: tweetId },
            select: { id: true, authorId: true },
        });

        if (!tweet) {
            return res.status(404).json({ error: "Tweet not found" });
        }

        const access = await getUserContentAccess(userId, tweet.authorId);
        if (!access.allowed) return res.status(403).json({ error: "This post is not available to your account." });

        if (tweet.authorId !== userId) {
            const block = await prisma.block.findFirst({
                where: {
                    OR: [
                        { blockerId: userId, blockedId: tweet.authorId },
                        { blockerId: tweet.authorId, blockedId: userId },
                    ],
                },
            });
            if (block) {
                return res.status(403).json({ error: "Cannot interact with a user you have blocked or who has blocked you" });
            }
        }

        const existingLike = await prisma.like.findUnique({
            where: {
                userId_tweetId: {
                    userId,
                    tweetId,
                },
            },
        });

        if (existingLike) {
            // Unlike
            await prisma.like.delete({
                where: {
                    userId_tweetId: {
                        userId,
                        tweetId,
                    },
                },
            });

            return res.status(200).json({
                message: "Unliked tweet",
                isLiked: false,
            });
        }

        // Like + create notification in a transaction
        await prisma.$transaction(async (tx) => {
            await tx.like.create({
                data: {
                    userId,
                    tweetId,
                },
            });

            if (tweet.authorId !== userId) {
                await tx.notification.create({
                    data: {
                        userId: tweet.authorId,
                        sourceUserId: userId,
                        type: "LIKE",
                        tweetId,
                    },
                });
            }
        });

        if (tweet.authorId !== userId) {
            emitNotificationToUser(tweet.authorId, {
                type: "LIKE",
                tweetId,
                sourceUser: { id: userId, username: req.user?.username },
            });
        }

        return res.status(200).json({
            message: "Liked tweet",
            isLiked: true,
        });
    } catch (error: any) {
        if (error.code === "P2002") {
            // Concurrency: like already exists
            return res.status(200).json({ message: "Liked tweet", isLiked: true });
        }
        if (error.code === "P2025") {
            // Concurrency: like already removed
            return res.status(200).json({ message: "Unliked tweet", isLiked: false });
        }
        console.error("Error in toggleLike:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 2. TOGGLE RETWEET / QUOTE RETWEET
// ==========================================
export const toggleRetweet = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const tweetId = req.params.tweetId as string;
        const { quoteContent } = req.body || {};

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (!tweetId) {
            return res.status(400).json({ error: "Tweet ID is required" });
        }

        if (quoteContent !== undefined && quoteContent !== null) {
            if (typeof quoteContent !== "string") {
                return res.status(400).json({ error: "Quote content must be a string" });
            }
            const entitlements = await getUserEntitlements(userId);
            if (countCharacters(quoteContent) > entitlements.maxPostCharacters) {
                return res.status(400).json({ error: `Quote exceeds your ${entitlements.maxPostCharacters} character plan limit. Upgrade your plan for a higher limit.` });
            }
        }

        const tweet = await prisma.tweet.findUnique({
            where: { id: tweetId },
            select: { id: true, authorId: true },
        });

        if (!tweet) {
            return res.status(404).json({ error: "Tweet not found" });
        }

        const access = await getUserContentAccess(userId, tweet.authorId);
        if (!access.allowed) return res.status(403).json({ error: "This post is not available to your account." });

        if (tweet.authorId !== userId) {
            const block = await prisma.block.findFirst({
                where: {
                    OR: [
                        { blockerId: userId, blockedId: tweet.authorId },
                        { blockerId: tweet.authorId, blockedId: userId },
                    ],
                },
            });
            if (block) {
                return res.status(403).json({ error: "Cannot interact with a user you have blocked or who has blocked you" });
            }
        }

        const existingRetweet = await prisma.retweet.findUnique({
            where: {
                userId_tweetId: {
                    userId,
                    tweetId,
                },
            },
        });

        if (existingRetweet && !quoteContent) {
            // Un-retweet
            await prisma.retweet.delete({
                where: {
                    userId_tweetId: {
                        userId,
                        tweetId,
                    },
                },
            });

            return res.status(200).json({
                message: "Un-retweeted",
                isRetweeted: false,
            });
        }

        await prisma.$transaction(async (tx) => {
            if (existingRetweet) {
                await tx.retweet.update({
                    where: {
                        userId_tweetId: {
                            userId,
                            tweetId,
                        },
                    },
                    data: {
                        quoteContent: quoteContent?.trim() || null,
                    },
                });
            } else {
                await tx.retweet.create({
                    data: {
                        userId,
                        tweetId,
                        quoteContent: quoteContent?.trim() || null,
                    },
                });
            }

            if (tweet.authorId !== userId) {
                await tx.notification.create({
                    data: {
                        userId: tweet.authorId,
                        sourceUserId: userId,
                        type: "RETWEET",
                        tweetId,
                    },
                });
            }
        });

        if (tweet.authorId !== userId) {
            emitNotificationToUser(tweet.authorId, {
                type: "RETWEET",
                tweetId,
                sourceUser: { id: userId, username: req.user?.username },
            });
        }

        return res.status(200).json({
            message: quoteContent ? "Quote posted" : "Retweeted",
            isRetweeted: true,
        });
    } catch (error: any) {
        if (error.code === "P2002") {
            return res.status(200).json({ message: "Retweeted", isRetweeted: true });
        }
        if (error.code === "P2025") {
            return res.status(200).json({ message: "Un-retweeted", isRetweeted: false });
        }
        console.error("Error in toggleRetweet:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 3. TOGGLE BOOKMARK
// ==========================================
export const toggleBookmark = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const tweetId = req.params.tweetId as string;

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (!tweetId) {
            return res.status(400).json({ error: "Tweet ID is required" });
        }

        const tweet = await prisma.tweet.findUnique({
            where: { id: tweetId },
            select: { id: true, authorId: true },
        });

        if (!tweet) {
            return res.status(404).json({ error: "Tweet not found" });
        }

        const access = await getUserContentAccess(userId, tweet.authorId);
        if (!access.allowed) return res.status(403).json({ error: "This post is not available to your account." });

        if (tweet.authorId !== userId) {
            const block = await prisma.block.findFirst({
                where: {
                    OR: [
                        { blockerId: userId, blockedId: tweet.authorId },
                        { blockerId: tweet.authorId, blockedId: userId },
                    ],
                },
            });
            if (block) {
                return res.status(403).json({ error: "Cannot interact with a user you have blocked or who has blocked you" });
            }
        }

        const existingBookmark = await prisma.bookmark.findUnique({
            where: {
                userId_tweetId: {
                    userId,
                    tweetId,
                },
            },
        });

        if (existingBookmark) {
            await prisma.bookmark.delete({
                where: {
                    userId_tweetId: {
                        userId,
                        tweetId,
                    },
                },
            });

            return res.status(200).json({
                message: "Bookmark removed",
                isBookmarked: false,
            });
        }

        await prisma.bookmark.create({
            data: {
                userId,
                tweetId,
            },
        });

        return res.status(200).json({
            message: "Tweet bookmarked",
            isBookmarked: true,
        });
    } catch (error: any) {
        if (error.code === "P2002") {
            return res.status(200).json({ message: "Tweet bookmarked", isBookmarked: true });
        }
        if (error.code === "P2025") {
            return res.status(200).json({ message: "Bookmark removed", isBookmarked: false });
        }
        console.error("Error in toggleBookmark:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 4. GET USER BOOKMARKS (PAGINATED)
// ==========================================
export const getUserBookmarks = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const limit = Math.min(Number(req.query.limit) || 10, 50);
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
            tweet: {
                AND: [
                    visibleTweetWhere(userId),
                    ...(blockedUserIds.length > 0 ? [{ authorId: { notIn: blockedUserIds } }] : []),
                ],
            },
        };

        const [bookmarks, totalCount] = await Promise.all([
            prisma.bookmark.findMany({
                where: whereClause,
                orderBy: { createdAt: "desc" },
                skip: offset,
                take: limit,
                include: {
                    tweet: {
                        include: {
                            author: {
                                select: {
                                    id: true,
                                    username: true,
                                    avatarUrl: true,
                                    isVerified: true,
                                },
                            },
                            media: {
                                orderBy: { order: "asc" },
                            },
                            hashtags: { include: { hashtag: true } },
                            _count: {
                                select: {
                                    likes: true,
                                    retweets: true,
                                    replies: { where: visibleTweetWhere(userId) },
                                    bookmarks: true,
                                },
                            },
                            likes: { where: { userId }, select: { id: true } },
                            retweets: { where: { userId }, select: { id: true } },
                        },
                    },
                },
            }),
            prisma.bookmark.count({ where: whereClause }),
        ]);

        const formattedTweets = bookmarks.map((b: any) => ({
            id: b.tweet.id,
            content: b.tweet.content,
            mediaUrl: b.tweet.mediaUrl,
            mediaType: b.tweet.mediaType,
            media: formatTweetMedia(b.tweet),
            createdAt: b.tweet.createdAt,
            author: b.tweet.author,
            hashtags: b.tweet.hashtags.map((h: any) => h.hashtag.tag),
            _count: b.tweet._count,
            isLiked: Boolean(b.tweet.likes?.length),
            isRetweeted: Boolean(b.tweet.retweets?.length),
            isBookmarked: true,
        }));

        return res.status(200).json({
            tweets: formattedTweets,
            pagination: {
                offset,
                limit,
                totalCount,
                hasMore: offset + limit < totalCount,
            },
        });
    } catch (error) {
        console.error("Error in getUserBookmarks:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};
