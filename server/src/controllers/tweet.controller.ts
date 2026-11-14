import { emitNotificationToUser, broadcastNewTweet } from '../socket.js';
import type { Response } from "express";
import { prisma } from "../index.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { deleteCloudinaryAsset } from "../lib/cloudinary.js";
import { getUserContentAccess, visibleTweetWhere } from "../lib/privacy.js";
import { getUserEntitlements } from "../lib/entitlements.js";
import { countCharacters } from "../lib/plan-config.js";

export const formatTweetMedia = (t: { media?: Array<any>; mediaUrl?: string | null; mediaType?: any }) => {
    if (t.media && t.media.length > 0) {
        return t.media.map((m) => ({
            id: m.id,
            url: m.url,
            publicId: m.publicId || null,
            mediaType: m.mediaType,
            order: m.order,
        }));
    }
    if (t.mediaUrl) {
        return [
            {
                id: "legacy",
                url: t.mediaUrl,
                publicId: null,
                mediaType: t.mediaType || "IMAGE",
                order: 0,
            },
        ];
    }
    return [];
};

interface ProcessedMediaResult {
    processedMedia: Array<{
        url: string;
        publicId: string | null;
        mediaType: "IMAGE" | "VIDEO" | "GIF";
    }>;
    primaryMediaUrl: string | null;
    primaryMediaType: "IMAGE" | "VIDEO" | "GIF" | null;
}

const cleanupPendingCloudinaryMedia = async (
    userId: string,
    media: ProcessedMediaResult["processedMedia"]
) => {
    const uploads = media.filter((item) => item.publicId && !item.publicId.startsWith("socialsphere/local/"));
    if (uploads.length === 0) return;
    await Promise.all(uploads.map((item) =>
        deleteCloudinaryAsset(item.publicId!, item.mediaType === "VIDEO" ? "video" : "image")
    ));
    try {
        await prisma.pendingUpload.updateMany({
            where: { userId, publicId: { in: uploads.map((item) => item.publicId!) }, status: "PENDING" },
            data: { status: "EXPIRED" },
        });
    } catch (error) {
        console.error("Unable to update failed media upload records:", error instanceof Error ? error.message : "Unknown error");
    }
};

const validateAndProcessMedia = async (
    userId: string,
    rawMedia: any,
    legacyMediaUrl: any,
    legacyMediaType: any
): Promise<{ error?: { status: number; message: string }; result?: ProcessedMediaResult }> => {
    if (rawMedia !== undefined && rawMedia !== null) {
        if (!Array.isArray(rawMedia)) {
            return { error: { status: 400, message: "Media must be an array of media objects" } };
        }
        if (rawMedia.length > 4) {
            return { error: { status: 400, message: "Cannot attach more than 4 media files per tweet" } };
        }

        const processed: Array<{ url: string; publicId: string | null; mediaType: "IMAGE" | "VIDEO" | "GIF" }> = [];

        for (const item of rawMedia) {
            if (!item || typeof item.url !== "string" || item.url.trim().length === 0) {
                return { error: { status: 400, message: "Each media attachment must have a valid non-empty url" } };
            }

            let mType: "IMAGE" | "VIDEO" | "GIF" = "IMAGE";
            if (item.mediaType) {
                if (!["IMAGE", "VIDEO", "GIF"].includes(item.mediaType)) {
                    return { error: { status: 400, message: "Invalid media type. Must be IMAGE, VIDEO, or GIF" } };
                }
                mType = item.mediaType;
            }

            const publicId = typeof item.publicId === "string" && item.publicId.trim().length > 0 ? item.publicId.trim() : null;

            if (publicId) {
                const upload = await prisma.pendingUpload.findUnique({
                    where: { publicId },
                });

                if (!upload || upload.userId !== userId) {
                    return { error: { status: 403, message: "Unauthorized or invalid media attachment ownership" } };
                }

                if (upload.url !== item.url.trim()) {
                    return { error: { status: 400, message: "Media URL does not match the authenticated upload" } };
                }

                if (upload.status !== "PENDING") {
                    return { error: { status: 403, message: "Media upload has already been attached to another post" } };
                }

                if (new Date(upload.expiresAt) < new Date()) {
                    return { error: { status: 403, message: "Media upload session has expired" } };
                }
            }

            processed.push({
                url: item.url.trim(),
                publicId,
                mediaType: mType,
            });
        }

        return {
            result: {
                processedMedia: processed,
                primaryMediaUrl: processed[0]?.url || null,
                primaryMediaType: processed[0]?.mediaType || null,
            },
        };
    }

    if (legacyMediaUrl !== undefined && legacyMediaUrl !== null) {
        if (typeof legacyMediaUrl !== "string") {
            return { error: { status: 400, message: "Media URL must be a string or null" } };
        }

        const cleanUrl = legacyMediaUrl.trim();
        if (cleanUrl.length > 0) {
            let mType: "IMAGE" | "VIDEO" | "GIF" = "IMAGE";
            if (legacyMediaType) {
                if (!["IMAGE", "VIDEO", "GIF"].includes(legacyMediaType)) {
                    return { error: { status: 400, message: "Invalid media type. Must be IMAGE, VIDEO, or GIF" } };
                }
                mType = legacyMediaType;
            }

            return {
                result: {
                    processedMedia: [{ url: cleanUrl, publicId: null, mediaType: mType }],
                    primaryMediaUrl: cleanUrl,
                    primaryMediaType: mType,
                },
            };
        }
    }

    return {
        result: {
            processedMedia: [],
            primaryMediaUrl: null,
            primaryMediaType: null,
        },
    };
};

export const extractHashtags = (content: string): string[] => {
    if (!content || typeof content !== "string") return [];
    // Match hashtags preceded by start-of-line, whitespace, or punctuation
    const matches = content.matchAll(/(?:^|[\s\p{P}])#([\p{L}\p{N}_]+)/gu);
    const tags: string[] = [];
    for (const match of matches) {
        const raw = match[1]?.trim().toLowerCase();
        // Valid hashtag: non-empty, contains at least one non-digit character (not purely numbers)
        if (raw && !/^\d+$/.test(raw)) {
            tags.push(raw);
        }
    }
    return Array.from(new Set(tags));
};

// ==========================================
// 1. CREATE TWEET (PREMIUM CHAR CHECK & HASHTAGS & MEDIA)
// ==========================================
export const createTweet = async (req: AuthenticatedRequest, res: Response) => {
    let mediaForCleanup: ProcessedMediaResult["processedMedia"] = [];
    try {
        const userId = req.user?.userId;
        const { content, mediaUrl, mediaType, media } = req.body;

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (!content || typeof content !== "string" || content.trim().length === 0) {
            return res.status(400).json({ error: "Tweet content cannot be empty" });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true },
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const entitlements = await getUserEntitlements(userId);
        const MAX_CHARS = entitlements.maxPostCharacters;
        if (countCharacters(content) > MAX_CHARS) {
            return res.status(400).json({
                error: `Post exceeds your ${MAX_CHARS} character plan limit. Upgrade your plan for a higher limit.`,
            });
        }

        const mediaValidation = await validateAndProcessMedia(userId, media, mediaUrl, mediaType);
        if (mediaValidation.error) {
            return res.status(mediaValidation.error.status).json({ error: mediaValidation.error.message });
        }
        const { processedMedia, primaryMediaUrl, primaryMediaType } = mediaValidation.result!;
        mediaForCleanup = processedMedia;

        const tagNames = extractHashtags(content);

        const publicIdsToConsume = processedMedia.map((m) => m.publicId).filter(Boolean) as string[];
        const tweet = await prisma.$transaction(async (tx) => {
            const createdTweet = await tx.tweet.create({
            data: {
                content: content.trim(),
                mediaUrl: primaryMediaUrl,
                mediaType: primaryMediaType,
                authorId: userId,
                ...(processedMedia.length > 0 ? {
                    media: {
                        create: processedMedia.map((m, idx) => ({
                            url: m.url,
                            publicId: m.publicId,
                            mediaType: m.mediaType,
                            order: idx,
                        })),
                    },
                } : {}),
                hashtags: {
                    create: tagNames.map((tag) => ({
                        hashtag: {
                            connectOrCreate: {
                                where: { tag },
                                create: { tag },
                            },
                        },
                    })),
                },
            },
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
                hashtags: {
                    include: { hashtag: true },
                },
                _count: {
                    select: {
                        likes: true,
                        retweets: true,
                        replies: true,
                        bookmarks: true,
                    },
                },
            },
            });

            if (publicIdsToConsume.length > 0) {
                const consumed = await tx.pendingUpload.updateMany({
                    where: {
                        publicId: { in: publicIdsToConsume },
                        userId,
                        status: "PENDING",
                        expiresAt: { gt: new Date() },
                    },
                    data: { status: "CONSUMED" },
                });
                if (consumed.count !== publicIdsToConsume.length) {
                    throw new Error("PENDING_MEDIA_CONFLICT");
                }
            }
            return createdTweet;
        });

        const authorPrivacy = await prisma.user.findUnique({ where: { id: userId }, select: { isPrivate: true } });
        if (!authorPrivacy?.isPrivate) broadcastNewTweet(tweet);
        return res.status(201).json({
            message: "Tweet posted successfully",
            tweet: {
                ...tweet,
                media: formatTweetMedia(tweet),
                hashtags: tweet.hashtags.map((h) => h.hashtag.tag),
                isLiked: false,
                isRetweeted: false,
                isBookmarked: false,
            },
        });
    } catch (error) {
        if (error instanceof Error && error.message === "PENDING_MEDIA_CONFLICT") {
            return res.status(409).json({ error: "One or more uploads expired or were already attached to a post." });
        }
        if (req.user?.userId) await cleanupPendingCloudinaryMedia(req.user.userId, mediaForCleanup);
        console.error("Error in createTweet:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 2. GET TIMELINE FEED (NUMBERED OFFSET PAGINATION + BLOCK FILTERING)
// ==========================================
export const getTimelineFeed = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const currentUserId = req.user?.userId;
        const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
        const feedType = (req.query.type as string) || "for-you";

        // Support both 1-indexed page and explicit offset
        let page = 1;
        let offset = 0;
        if (req.query.page) {
            page = Math.max(Number(req.query.page) || 1, 1);
            offset = (page - 1) * limit;
        } else if (req.query.offset) {
            offset = Math.max(Number(req.query.offset) || 0, 0);
            page = Math.floor(offset / limit) + 1;
        }

        // Guests requesting "following" tab get empty feed
        if (feedType === "following" && !currentUserId) {
            return res.status(200).json({
                tweets: [],
                pagination: {
                    page: 1,
                    limit,
                    offset: 0,
                    totalCount: 0,
                    totalPages: 1,
                    hasNextPage: false,
                    hasPrevPage: false,
                    hasMore: false,
                },
            });
        }

        let blockedUserIds: string[] = [];
        let followingUserIds: string[] = [];

        if (currentUserId) {
            const [blocks, follows] = await Promise.all([
                prisma.block.findMany({
                    where: {
                        OR: [{ blockerId: currentUserId }, { blockedId: currentUserId }],
                    },
                    select: { blockerId: true, blockedId: true },
                }),
                feedType === "following"
                    ? prisma.follow.findMany({
                          where: { followerId: currentUserId },
                          select: { followingId: true },
                      })
                    : Promise.resolve([]),
            ]);

            blockedUserIds = blocks.map((b) =>
                b.blockerId === currentUserId ? b.blockedId : b.blockerId
            );

            if (feedType === "following") {
                const rawFollowingIds = follows.map((f) => f.followingId);
                followingUserIds = rawFollowingIds.filter((id) => !blockedUserIds.includes(id));
                followingUserIds.push(currentUserId);
            }
        }

        const whereClause: any = {
            parentTweetId: null,
            authorId: {
                notIn: blockedUserIds,
            },
            AND: [visibleTweetWhere(currentUserId)],
        };

        if (feedType === "following" && currentUserId) {
            whereClause.authorId = {
                in: followingUserIds,
                notIn: blockedUserIds,
            };
        }

        const activeUserId = currentUserId || "";

        const [tweets, totalCount] = await Promise.all([
            prisma.tweet.findMany({
                where: whereClause,
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                skip: offset,
                take: limit,
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
                    hashtags: {
                        include: { hashtag: true },
                    },
                    _count: {
                        select: {
                            likes: true,
                            retweets: true,
                            replies: { where: visibleTweetWhere(currentUserId) },
                            bookmarks: true,
                        },
                    },
                    likes: { where: { userId: activeUserId }, select: { id: true } },
                    retweets: { where: { userId: activeUserId }, select: { id: true } },
                    bookmarks: { where: { userId: activeUserId }, select: { id: true } },
                },
            }),
            prisma.tweet.count({ where: whereClause }),
        ]);

        const formattedTweets = tweets.map((t) => ({
            id: t.id,
            content: t.content,
            mediaUrl: t.mediaUrl,
            mediaType: t.mediaType,
            media: formatTweetMedia(t),
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            author: t.author,
            hashtags: t.hashtags.map((h) => h.hashtag.tag),
            _count: t._count,
            isLiked: Boolean(currentUserId && t.likes.length > 0),
            isRetweeted: Boolean(currentUserId && t.retweets.length > 0),
            isBookmarked: Boolean(currentUserId && t.bookmarks.length > 0),
        }));

        const totalPages = Math.max(1, Math.ceil(totalCount / limit));
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;

        return res.status(200).json({
            tweets: formattedTweets,
            pagination: {
                page,
                limit,
                offset,
                totalCount,
                totalPages,
                hasNextPage,
                hasPrevPage,
                hasMore: offset + limit < totalCount,
            },
        });
    } catch (error) {
        console.error("Error in getTimelineFeed:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 3. GET SINGLE TWEET (THREADED REPLIES)
// ==========================================
export const getTweetById = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const id = req.params.id as string;
        const currentUserId = req.user?.userId;
        const activeUserId = currentUserId || "";

        if (!id) {
            return res.status(400).json({ error: "Tweet ID is required" });
        }

        const tweet = await prisma.tweet.findUnique({
            where: { id },
            include: {
                author: {
                    select: {
                        id: true,
                        username: true,
                        avatarUrl: true,
                        isVerified: true,
                        bio: true,
                    },
                },
                media: {
                    orderBy: { order: "asc" },
                },
                hashtags: {
                    include: { hashtag: true },
                },
                _count: {
                    select: {
                        likes: true,
                        retweets: true,
                        replies: { where: visibleTweetWhere(currentUserId) },
                        bookmarks: true,
                    },
                },
                likes: { where: { userId: activeUserId }, select: { id: true } },
                retweets: { where: { userId: activeUserId }, select: { id: true } },
                bookmarks: { where: { userId: activeUserId }, select: { id: true } },
                replies: {
                    where: visibleTweetWhere(currentUserId),
                    orderBy: { createdAt: "asc" },
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
                        hashtags: {
                            include: { hashtag: true },
                        },
                        _count: {
                            select: {
                                likes: true,
                                retweets: true,
                                replies: { where: visibleTweetWhere(currentUserId) },
                                bookmarks: true,
                            },
                        },
                        likes: { where: { userId: activeUserId }, select: { id: true } },
                        retweets: { where: { userId: activeUserId }, select: { id: true } },
                        bookmarks: { where: { userId: activeUserId }, select: { id: true } },
                    },
                },
            },
        });

        if (!tweet) {
            return res.status(404).json({ error: "Tweet not found" });
        }

        const access = await getUserContentAccess(currentUserId, tweet.author.id);
        if (!access.allowed) {
            return res.status(403).json({ error: access.blocked ? "Cannot view tweet from a blocked user" : "This account is private. Follow to see its posts." });
        }

        let repliesToInclude = tweet.replies;
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
            const blockedUserIds = new Set(
                blocks.map((b) => (b.blockerId === currentUserId ? b.blockedId : b.blockerId))
            );
            if (blockedUserIds.size > 0) {
                repliesToInclude = tweet.replies.filter((r) => !blockedUserIds.has(r.author.id));
            }
        }

        const formattedReplies = repliesToInclude.map((r) => ({
            id: r.id,
            content: r.content,
            mediaUrl: r.mediaUrl,
            mediaType: r.mediaType,
            media: formatTweetMedia(r),
            createdAt: r.createdAt,
            author: r.author,
            hashtags: r.hashtags.map((h: any) => h.hashtag.tag),
            _count: r._count,
            isLiked: Boolean(currentUserId && r.likes.length > 0),
            isRetweeted: Boolean(currentUserId && r.retweets.length > 0),
            isBookmarked: Boolean(currentUserId && r.bookmarks.length > 0),
        }));

        return res.status(200).json({
            tweet: {
                id: tweet.id,
                content: tweet.content,
                mediaUrl: tweet.mediaUrl,
                mediaType: tweet.mediaType,
                media: formatTweetMedia(tweet),
                createdAt: tweet.createdAt,
                updatedAt: tweet.updatedAt,
                author: tweet.author,
                hashtags: tweet.hashtags.map((h) => h.hashtag.tag),
                _count: tweet._count,
                isLiked: Boolean(currentUserId && tweet.likes.length > 0),
                isRetweeted: Boolean(currentUserId && tweet.retweets.length > 0),
                isBookmarked: Boolean(currentUserId && tweet.bookmarks.length > 0),
                replies: formattedReplies,
            },
        });
    } catch (error) {
        console.error("Error in getTweetById:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 4. CREATE REPLY (THREADED)
// ==========================================
export const createReply = async (req: AuthenticatedRequest, res: Response) => {
    let mediaForCleanup: ProcessedMediaResult["processedMedia"] = [];
    try {
        const userId = req.user?.userId;
        const parentTweetId = req.params.parentTweetId as string;
        const { content, mediaUrl, mediaType, media } = req.body;

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (!parentTweetId) {
            return res.status(400).json({ error: "Parent tweet ID required" });
        }

        if (!content || typeof content !== "string" || content.trim().length === 0) {
            return res.status(400).json({ error: "Reply content cannot be empty" });
        }

        const parentTweet = await prisma.tweet.findUnique({
            where: { id: parentTweetId },
            select: { id: true, authorId: true },
        });

        if (!parentTweet) {
            return res.status(404).json({ error: "Parent tweet not found" });
        }

        const parentAccess = await getUserContentAccess(userId, parentTweet.authorId);
        if (!parentAccess.allowed) {
            return res.status(403).json({ error: parentAccess.blocked ? "Cannot reply to a blocked user" : "This account is private. Follow to reply." });
        }

        if (parentTweet.authorId !== userId) {
            const block = await prisma.block.findFirst({
                where: {
                    OR: [
                        { blockerId: userId, blockedId: parentTweet.authorId },
                        { blockerId: parentTweet.authorId, blockedId: userId },
                    ],
                },
            });
            if (block) {
                return res.status(403).json({ error: "Cannot reply to a blocked user" });
            }
        }

        const entitlements = await getUserEntitlements(userId);
        const MAX_CHARS = entitlements.maxPostCharacters;
        if (countCharacters(content) > MAX_CHARS) {
            return res.status(400).json({
                error: `Reply exceeds your ${MAX_CHARS} character plan limit. Upgrade your plan for a higher limit.`,
            });
        }

        const mediaValidation = await validateAndProcessMedia(userId, media, mediaUrl, mediaType);
        if (mediaValidation.error) {
            return res.status(mediaValidation.error.status).json({ error: mediaValidation.error.message });
        }
        const { processedMedia, primaryMediaUrl, primaryMediaType } = mediaValidation.result!;
        mediaForCleanup = processedMedia;

        const tagNames = extractHashtags(content);

        const reply = await prisma.$transaction(async (tx) => {
            const newReply = await tx.tweet.create({
                data: {
                    content: content.trim(),
                    mediaUrl: primaryMediaUrl,
                    mediaType: primaryMediaType,
                    authorId: userId,
                    parentTweetId: parentTweet.id,
                    ...(processedMedia.length > 0 ? {
                        media: {
                            create: processedMedia.map((m, idx) => ({
                                url: m.url,
                                publicId: m.publicId,
                                mediaType: m.mediaType,
                                order: idx,
                            })),
                        },
                    } : {}),
                    hashtags: {
                        create: tagNames.map((tag) => ({
                            hashtag: {
                                connectOrCreate: {
                                    where: { tag },
                                    create: { tag },
                                },
                            },
                        })),
                    },
                },
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
                    hashtags: {
                        include: { hashtag: true },
                    },
                    _count: {
                        select: {
                            likes: true,
                            retweets: true,
                            replies: { where: visibleTweetWhere(userId) },
                            bookmarks: true,
                        },
                    },
                },
            });

            if (parentTweet.authorId !== userId) {
                await tx.notification.create({
                    data: {
                        userId: parentTweet.authorId,
                        sourceUserId: userId,
                        type: "REPLY",
                        tweetId: parentTweet.id,
                    },
                });
            }

            const publicIdsToConsume = processedMedia.map((m) => m.publicId).filter(Boolean) as string[];
            if (publicIdsToConsume.length > 0) {
                const consumed = await tx.pendingUpload.updateMany({
                    where: {
                        publicId: { in: publicIdsToConsume },
                        userId,
                        status: "PENDING",
                        expiresAt: { gt: new Date() },
                    },
                    data: { status: "CONSUMED" },
                });
                if (consumed.count !== publicIdsToConsume.length) {
                    throw new Error("PENDING_MEDIA_CONFLICT");
                }
            }

            return newReply;
        });

        if (parentTweet.authorId !== userId) {
            emitNotificationToUser(parentTweet.authorId, {
                type: "REPLY",
                tweetId: parentTweet.id,
                sourceUser: { id: userId, username: req.user?.username },
            });
        }

        return res.status(201).json({
            message: "Reply posted successfully",
            reply: {
                ...reply,
                media: formatTweetMedia(reply),
                hashtags: reply.hashtags.map((h) => h.hashtag.tag),
                isLiked: false,
                isRetweeted: false,
                isBookmarked: false,
            },
        });
    } catch (error) {
        if (error instanceof Error && error.message === "PENDING_MEDIA_CONFLICT") {
            return res.status(409).json({ error: "One or more uploads expired or were already attached to a post." });
        }
        if (req.user?.userId) await cleanupPendingCloudinaryMedia(req.user.userId, mediaForCleanup);
        console.error("Error in createReply:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 5. DELETE TWEET
// ==========================================
export const deleteTweet = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const id = req.params.id as string;

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        if (!id) {
            return res.status(400).json({ error: "Tweet ID is required" });
        }

        const tweet = await prisma.tweet.findUnique({
            where: { id },
            include: { media: true },
        });

        if (!tweet) {
            return res.status(404).json({ error: "Tweet not found" });
        }

        if (tweet.authorId !== userId) {
            return res.status(403).json({ error: "You are not authorized to delete this tweet" });
        }

        // Clean up Cloudinary assets associated with this tweet
        if (tweet.media && tweet.media.length > 0) {
            for (const item of tweet.media) {
                if (item.publicId) {
                    try {
                        await deleteCloudinaryAsset(item.publicId, item.mediaType === "VIDEO" ? "video" : "image");
                    } catch (err) {
                        console.error(`Failed to delete Cloudinary asset ${item.publicId}:`, err);
                    }
                }
            }
        }

        // Cleanly disassociate child replies before deleting parent tweet to avoid foreign-key constraint failure
        await prisma.$transaction(async (tx) => {
            await tx.tweet.updateMany({
                where: { parentTweetId: id },
                data: { parentTweetId: null },
            });

            await tx.tweet.delete({
                where: { id },
            });
        });

        return res.status(200).json({ message: "Tweet deleted successfully" });
    } catch (error) {
        console.error("Error in deleteTweet:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 6. GET USER'S TWEETS (PROFILE FEED)
// ==========================================
export const getUserTweets = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const username = req.params.username as string;
        const currentUserId = req.user?.userId;
        const activeUserId = currentUserId || "";
        const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);

        let page = 1;
        let offset = 0;
        if (req.query.page) {
            page = Math.max(Number(req.query.page) || 1, 1);
            offset = (page - 1) * limit;
        } else if (req.query.offset) {
            offset = Math.max(Number(req.query.offset) || 0, 0);
            page = Math.floor(offset / limit) + 1;
        }

        if (!username) {
            return res.status(400).json({ error: "Username parameter is required" });
        }

        const targetUser = await prisma.user.findUnique({
            where: { username },
            select: { id: true, isPrivate: true },
        });

        if (!targetUser) {
            return res.status(404).json({ error: "User not found" });
        }

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
                return res.status(200).json({
                    tweets: [],
                    pagination: {
                        page: 1,
                        limit,
                        offset: 0,
                        totalCount: 0,
                        totalPages: 1,
                        hasNextPage: false,
                        hasPrevPage: false,
                        hasMore: false,
                    },
                    isBlocked: true,
                });
            }
        }

        const profileAccess = await getUserContentAccess(currentUserId, targetUser.id);
        if (!profileAccess.allowed) {
            return res.status(403).json({ error: "This account is private. Follow to see its posts.", isPrivate: true });
        }

        const [tweets, totalCount] = await Promise.all([
            prisma.tweet.findMany({
                where: { authorId: targetUser.id, parentTweetId: null },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                skip: offset,
                take: limit,
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
                    hashtags: {
                        include: { hashtag: true },
                    },
                    _count: {
                        select: {
                            likes: true,
                            retweets: true,
                            replies: { where: visibleTweetWhere(currentUserId) },
                            bookmarks: true,
                        },
                    },
                    likes: { where: { userId: activeUserId }, select: { id: true } },
                    retweets: { where: { userId: activeUserId }, select: { id: true } },
                    bookmarks: { where: { userId: activeUserId }, select: { id: true } },
                },
            }),
            prisma.tweet.count({
                where: { authorId: targetUser.id, parentTweetId: null },
            }),
        ]);

        const formattedTweets = tweets.map((t) => ({
            id: t.id,
            content: t.content,
            mediaUrl: t.mediaUrl,
            mediaType: t.mediaType,
            media: formatTweetMedia(t),
            createdAt: t.createdAt,
            author: t.author,
            hashtags: t.hashtags.map((h) => h.hashtag.tag),
            _count: t._count,
            isLiked: Boolean(currentUserId && t.likes.length > 0),
            isRetweeted: Boolean(currentUserId && t.retweets.length > 0),
            isBookmarked: Boolean(currentUserId && t.bookmarks.length > 0),
        }));

        const totalPages = Math.max(1, Math.ceil(totalCount / limit));
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;

        return res.status(200).json({
            tweets: formattedTweets,
            pagination: {
                page,
                limit,
                offset,
                totalCount,
                totalPages,
                hasNextPage,
                hasPrevPage,
                hasMore: offset + limit < totalCount,
            },
        });
    } catch (error) {
        console.error("Error in getUserTweets:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 7. GET TWEETS BY HASHTAG
// ==========================================
export const getTweetsByHashtag = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const rawTag = req.params.tag as string;
        const currentUserId = req.user?.userId;
        const activeUserId = currentUserId || "";
        const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);

        let page = 1;
        let offset = 0;
        if (req.query.page) {
            page = Math.max(Number(req.query.page) || 1, 1);
            offset = (page - 1) * limit;
        } else if (req.query.offset) {
            offset = Math.max(Number(req.query.offset) || 0, 0);
            page = Math.floor(offset / limit) + 1;
        }

        if (!rawTag) {
            return res.status(400).json({ error: "Tag is required" });
        }

        const tag = decodeURIComponent(rawTag).replace(/^#/, "").trim().toLowerCase();

        if (!tag) {
            return res.status(400).json({ error: "Valid tag is required" });
        }

        let blockedUserIds: string[] = [];
        if (currentUserId) {
            const blocks = await prisma.block.findMany({
                where: {
                    OR: [{ blockerId: currentUserId }, { blockedId: currentUserId }],
                },
                select: { blockerId: true, blockedId: true },
            });
            blockedUserIds = blocks.map((b) => (b.blockerId === currentUserId ? b.blockedId : b.blockerId));
        }

        const hashtagRecord = await prisma.hashtag.findUnique({
            where: { tag },
            select: { id: true },
        });

        if (!hashtagRecord) {
            return res.status(200).json({
                tweets: [],
                pagination: {
                    page: 1,
                    limit,
                    offset: 0,
                    totalCount: 0,
                    totalPages: 1,
                    hasNextPage: false,
                    hasPrevPage: false,
                    hasMore: false,
                },
            });
        }

        const whereClause: any = {
            hashtagId: hashtagRecord.id,
            tweet: {
                AND: [
                    visibleTweetWhere(currentUserId),
                    ...(blockedUserIds.length > 0 ? [{ authorId: { notIn: blockedUserIds } }] : []),
                ],
            },
        };

        const [tweetHashtags, totalCount] = await Promise.all([
            prisma.tweetHashtag.findMany({
                where: whereClause,
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
                                    replies: { where: visibleTweetWhere(currentUserId) },
                                    bookmarks: true,
                                },
                            },
                            likes: { where: { userId: activeUserId }, select: { id: true } },
                            retweets: { where: { userId: activeUserId }, select: { id: true } },
                            bookmarks: { where: { userId: activeUserId }, select: { id: true } },
                        },
                    },
                },
            }),
            prisma.tweetHashtag.count({ where: whereClause }),
        ]);

        const formattedTweets = tweetHashtags.map((th) => ({
            id: th.tweet.id,
            content: th.tweet.content,
            mediaUrl: th.tweet.mediaUrl,
            mediaType: th.tweet.mediaType,
            media: formatTweetMedia(th.tweet),
            createdAt: th.tweet.createdAt,
            author: th.tweet.author,
            hashtags: th.tweet.hashtags.map((h) => h.hashtag.tag),
            _count: th.tweet._count,
            isLiked: Boolean(currentUserId && th.tweet.likes.length > 0),
            isRetweeted: Boolean(currentUserId && th.tweet.retweets.length > 0),
            isBookmarked: Boolean(currentUserId && th.tweet.bookmarks.length > 0),
        }));

        const totalPages = Math.max(1, Math.ceil(totalCount / limit));
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;

        return res.status(200).json({
            tweets: formattedTweets,
            pagination: {
                page,
                limit,
                offset,
                totalCount,
                totalPages,
                hasNextPage,
                hasPrevPage,
                hasMore: offset + limit < totalCount,
            },
        });
    } catch (error) {
        console.error("Error in getTweetsByHashtag:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// 8. GET TRENDING HASHTAGS
// ==========================================
export const getTrendingHashtags = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 30);
        const currentUserId = req.user?.userId;

        let blockedUserIds: string[] = [];
        if (currentUserId) {
            const blocks = await prisma.block.findMany({
                where: {
                    OR: [{ blockerId: currentUserId }, { blockedId: currentUserId }],
                },
                select: { blockerId: true, blockedId: true },
            });
            blockedUserIds = blocks.map((b) => (b.blockerId === currentUserId ? b.blockedId : b.blockerId));
        }

        const visibleHashtagTweet = {
            AND: [
                visibleTweetWhere(currentUserId),
                ...(blockedUserIds.length > 0 ? [{ authorId: { notIn: blockedUserIds } }] : []),
            ],
        };
        const hashtags = await prisma.hashtag.findMany({
            where: {
                tweets: { some: { tweet: visibleHashtagTweet } },
            },
            select: {
                id: true,
                tag: true,
                _count: {
                    select: {
                        tweets: { where: { tweet: visibleHashtagTweet } },
                    },
                },
            },
            orderBy: {
                tweets: {
                    _count: "desc",
                },
            },
            take: limit,
        });

        const trends = hashtags.map((h) => ({
            id: h.id,
            tag: h.tag,
            tweetCount: h._count.tweets,
        }));

        return res.status(200).json({ trends });
    } catch (error) {
        console.error("Error in getTrendingHashtags:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};
