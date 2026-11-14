import { prisma } from "../index.js";

export type DirectMessageAccess = {
    allowed: boolean;
    blocked: boolean;
    otherFollowsUser: boolean;
};

export const getDirectMessageAccess = async (
    userId: string,
    otherUserId: string
): Promise<DirectMessageAccess> => {
    const [block, followedBy] = await Promise.all([
        prisma.block.findFirst({
            where: {
                OR: [
                    { blockerId: userId, blockedId: otherUserId },
                    { blockerId: otherUserId, blockedId: userId },
                ],
            },
            select: { id: true },
        }),
        prisma.follow.findUnique({
            where: { followerId_followingId: { followerId: otherUserId, followingId: userId } },
            select: { id: true },
        }),
    ]);

    // Unblocked users may start a request. Conversation state decides whether it
    // appears in the recipient's Requests or the normal conversation list.
    return { allowed: !block, blocked: Boolean(block), otherFollowsUser: Boolean(followedBy) };
};

export const directMessageAccessError = (access: DirectMessageAccess) =>
    access.blocked
        ? "Cannot message a blocked user"
        : "This direct message is not available";
