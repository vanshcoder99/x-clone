import { prisma } from "../index.js";

export const visibleTweetWhere = (viewerId?: string) => ({
    OR: [
        ...(viewerId ? [{ authorId: viewerId }] : []),
        { author: { isPrivate: false } },
        ...(viewerId ? [{ author: { followers: { some: { followerId: viewerId } } } }] : []),
    ],
});

export const privateTweetNotificationWhere = (viewerId: string) => ({
    OR: [
        { tweetId: null },
        { tweet: { authorId: viewerId } },
        { tweet: { author: { isPrivate: false } } },
        { tweet: { author: { followers: { some: { followerId: viewerId } } } } },
    ],
});

export const getUserContentAccess = async (viewerId: string | undefined, ownerId: string) => {
    const owner = await prisma.user.findUnique({
        where: { id: ownerId },
        select: { isPrivate: true },
    });
    if (!owner) return { allowed: false, notFound: true, isPrivate: false, isFollowing: false, blocked: false };
    if (!viewerId || viewerId === ownerId) {
        return { allowed: !owner.isPrivate || viewerId === ownerId, notFound: false, isPrivate: owner.isPrivate, isFollowing: viewerId === ownerId, blocked: false };
    }

    const [block, follow] = await Promise.all([
        prisma.block.findFirst({
            where: { OR: [{ blockerId: viewerId, blockedId: ownerId }, { blockerId: ownerId, blockedId: viewerId }] },
            select: { id: true },
        }),
        prisma.follow.findUnique({
            where: { followerId_followingId: { followerId: viewerId, followingId: ownerId } },
            select: { id: true },
        }),
    ]);
    const isFollowing = !!follow;
    return {
        allowed: !block && (!owner.isPrivate || isFollowing),
        notFound: false,
        isPrivate: owner.isPrivate,
        isFollowing,
        blocked: !!block,
    };
};

