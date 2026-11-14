export interface User {
    id: string;
    name?: string | null;
    username: string;
    email?: string;
    bio?: string | null;
    avatarUrl?: string | null;
    isVerified: boolean;
    isPrivate?: boolean;
    hasPassword?: boolean;
    createdAt: string;
    subscription?: {
        tier: "FREE" | "PLUS" | "PRO" | "PREMIUM";
        status: "ACTIVE" | "PENDING" | "EXPIRED" | "CANCELLED" | "HALTED" | "COMPLETED";
    } | null;
    entitlements?: {
        tier: "FREE" | "PLUS" | "PRO";
        monthlyCredits: number;
        creditsUsed: number;
        creditsRemaining: number;
        maxPostCharacters: number;
        currentPeriodStart: string;
        currentPeriodEnd: string;
        cancelAtPeriodEnd: boolean;
    };
    _count?: {
        followers: number;
        following: number;
        tweets: number;
    };
    isFollowing?: boolean;
    isFollowRequested?: boolean;
    followRequestId?: string | null;
    canViewContent?: boolean;
    isBlocked?: boolean;
    isBlockedBy?: boolean;
}

export interface TweetMediaItem {
    id: string;
    url: string;
    publicId?: string | null;
    mediaType: "IMAGE" | "VIDEO" | "GIF";
    order: number;
}

export interface Tweet {
    id: string;
    content: string;
    mediaUrl?: string | null;
    mediaType?: "IMAGE" | "VIDEO" | "GIF" | null;
    media?: TweetMediaItem[];
    createdAt: string;
    updatedAt: string;
    author: {
        id: string;
        username: string;
        avatarUrl?: string | null;
        isVerified: boolean;
        bio?: string | null;
    };
    hashtags?: string[];
    _count: {
        likes: number;
        retweets: number;
        replies: number;
        bookmarks?: number;
    };
    isLiked: boolean;
    isRetweeted: boolean;
    isBookmarked: boolean;
    replies?: Tweet[];
}

export interface NotificationItem {
    id: string;
    type: "LIKE" | "RETWEET" | "FOLLOW" | "FOLLOW_REQUEST" | "FOLLOW_REQUEST_ACCEPTED" | "FOLLOW_REQUEST_REJECTED" | "REPLY";
    read: boolean;
    createdAt: string;
    sourceUser: {
        id: string;
        username: string;
        avatarUrl?: string | null;
        isVerified: boolean;
    };
    tweet?: {
        id: string;
        content: string;
    } | null;
}

export interface DirectMessage {
    id: string;
    conversationId: string;
    senderId: string;
    content: string;
    mediaUrl?: string | null;
    createdAt: string;
    sender: {
        id: string;
        username: string;
        avatarUrl?: string | null;
        isVerified: boolean;
    };
}

export interface ConversationParticipant {
    id: string;
    conversationId: string;
    userId: string;
    hasReadLatest: boolean;
    lastReadAt?: string | null;
    archivedAt?: string | null;
    joinedAt: string;
    user: {
        id: string;
        name?: string | null;
        username: string;
        avatarUrl?: string | null;
        isVerified: boolean;
    };
}

export interface Conversation {
    id: string;
    createdAt: string;
    updatedAt: string;
    status?: "ACTIVE" | "PENDING";
    requestedById?: string | null;
    participants: ConversationParticipant[];
    messages?: DirectMessage[];
    hasUnread?: boolean;
    unreadCount?: number;
    otherUser?: {
        id: string;
        name?: string | null;
        username: string;
        avatarUrl?: string | null;
        isVerified: boolean;
    } | null;
}

export interface PaginationMeta {
    page: number;
    limit: number;
    offset: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
    hasMore?: boolean;
}

export interface TrendingTopic {
    id: string;
    tag: string;
    tweetCount: number;
}
