import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
    Heart,
    Repeat,
    MessageCircle,
    Bookmark,
    Trash2,
    CheckCircle,
    Share2,
    MoreHorizontal,
} from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../features/auth/hooks";
import { MediaLightboxModal } from "./MediaLightboxModal";
import type { Tweet, TweetMediaItem } from "../types";

interface TweetCardProps {
    tweet: Tweet;
    onDelete?: (tweetId: string) => void;
    onOpenReply?: (tweet: Tweet) => void;
}

const getMediaUrl = (url: string) => {
    if (!url) return "";
    if (url.startsWith("/uploads/")) {
        const backendOrigin = (import.meta.env.VITE_API_URL || "http://localhost:5000/api").replace(/\/api$/, "");
        return `${backendOrigin}${url}`;
    }
    return url;
};

export const TweetCard: React.FC<TweetCardProps> = ({
    tweet,
    onDelete,
    onOpenReply,
}) => {
    const { user } = useAuth();
    const navigate = useNavigate();

    const [isLiked, setIsLiked] = useState(tweet.isLiked);
    const [likesCount, setLikesCount] = useState(tweet._count.likes);
    const [isLikeLoading, setIsLikeLoading] = useState(false);

    const [isRetweeted, setIsRetweeted] = useState(tweet.isRetweeted);
    const [retweetsCount, setRetweetsCount] = useState(tweet._count.retweets);
    const [isRetweetLoading, setIsRetweetLoading] = useState(false);

    const [isBookmarked, setIsBookmarked] = useState(tweet.isBookmarked);
    const [isBookmarkLoading, setIsBookmarkLoading] = useState(false);

    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);

    const mediaList: TweetMediaItem[] =
        tweet.media && tweet.media.length > 0
            ? tweet.media
            : tweet.mediaUrl
            ? [
                  {
                      id: "legacy",
                      url: tweet.mediaUrl,
                      mediaType: tweet.mediaType || "IMAGE",
                      order: 0,
                  },
              ]
            : [];

    const isAuthor = user?.id === tweet.author.id;

    // Synchronize local optimistic state when props change
    useEffect(() => {
        setIsLiked(tweet.isLiked);
        setLikesCount(tweet._count.likes);
        setIsRetweeted(tweet.isRetweeted);
        setRetweetsCount(tweet._count.retweets);
        setIsBookmarked(tweet.isBookmarked);
    }, [tweet.id, tweet.isLiked, tweet.isRetweeted, tweet.isBookmarked, tweet._count.likes, tweet._count.retweets]);

    // Helper: format relative time
    const formatTime = (dateString: string) => {
        const diff = Date.now() - new Date(dateString).getTime();
        const mins = Math.floor(diff / (1000 * 60));
        if (mins < 1) return "Just now";
        if (mins < 60) return `${mins}m`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h`;
        const days = Math.floor(hours / 24);
        return `${days}d`;
    };

    const handleLike = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!user) {
            navigate("/auth");
            return;
        }

        if (isLikeLoading) return;
        setIsLikeLoading(true);

        // Optimistic UI update
        const nextLiked = !isLiked;
        setIsLiked(nextLiked);
        setLikesCount((prev) => (nextLiked ? prev + 1 : Math.max(0, prev - 1)));

        try {
            const { data } = await api.post(`/tweets/${tweet.id}/like`);
            if (data && typeof data.isLiked === "boolean") {
                setIsLiked(data.isLiked);
                setLikesCount(data.likesCount);
            }
        } catch (err) {
            // Revert on error
            setIsLiked(!nextLiked);
            setLikesCount((prev) => (!nextLiked ? prev + 1 : Math.max(0, prev - 1)));
        } finally {
            setIsLikeLoading(false);
        }
    };

    const handleRetweet = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!user) {
            navigate("/auth");
            return;
        }

        if (isRetweetLoading) return;
        setIsRetweetLoading(true);

        const nextRetweeted = !isRetweeted;
        setIsRetweeted(nextRetweeted);
        setRetweetsCount((prev) => (nextRetweeted ? prev + 1 : Math.max(0, prev - 1)));

        try {
            const { data } = await api.post(`/tweets/${tweet.id}/retweet`);
            if (data && typeof data.isRetweeted === "boolean") {
                setIsRetweeted(data.isRetweeted);
                setRetweetsCount(data.retweetsCount);
            }
        } catch (err) {
            // Revert
            setIsRetweeted(!nextRetweeted);
            setRetweetsCount((prev) => (!nextRetweeted ? prev + 1 : Math.max(0, prev - 1)));
        } finally {
            setIsRetweetLoading(false);
        }
    };

    const handleBookmark = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!user) {
            navigate("/auth");
            return;
        }

        if (isBookmarkLoading) return;
        setIsBookmarkLoading(true);

        const nextBookmarked = !isBookmarked;
        setIsBookmarked(nextBookmarked);

        try {
            const { data } = await api.post(`/tweets/${tweet.id}/bookmark`);
            if (data && typeof data.isBookmarked === "boolean") {
                setIsBookmarked(data.isBookmarked);
            }
        } catch (err) {
            setIsBookmarked(!nextBookmarked);
        } finally {
            setIsBookmarkLoading(false);
        }
    };

    const handleDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm("Are you sure you want to delete this post?")) return;

        try {
            await api.delete(`/tweets/${tweet.id}`);
            if (onDelete) {
                onDelete(tweet.id);
            }
        } catch (err) {
            console.error("Failed to delete post:", err);
            alert("Could not delete post. Please try again.");
        }
    };

    // Render text with clickable #hashtags
    const renderContentWithHashtags = (content: string) => {
        const parts = content.split(/(#[a-zA-Z0-9_]+)/g);
        return parts.map((part, index) => {
            if (part.startsWith("#")) {
                const tag = part.slice(1);
                if (!/^\d+$/.test(tag)) {
                    return (
                        <span
                            key={index}
                            className="text-accent-blue hover:underline cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/explore?tag=${encodeURIComponent(tag.toLowerCase())}`);
                            }}
                        >
                            {part}
                        </span>
                    );
                }
            }
            return part;
        });
    };

    return (
        <article
            className="tweet-card flex gap-3 px-4 py-3.5 border-b border-border-dark hover:bg-white/[0.02] cursor-pointer transition-colors"
            onClick={() => navigate(`/tweet/${tweet.id}`)}
        >
            {/* Author Avatar */}
            <img
                src={
                    tweet.author.avatarUrl ||
                    `https://api.dicebear.com/7.x/identicon/svg?seed=${tweet.author.username}`
                }
                alt={tweet.author.username}
                className="w-10 h-10 rounded-full object-cover bg-surface-secondary border border-border-dark flex-shrink-0"
                onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/profile/${tweet.author.username}`);
                }}
            />

            <div className="flex-1 min-w-0">
                {/* Header row */}
                <div className="flex justify-between items-center mb-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                            className="font-bold text-sm text-text-primary hover:underline cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/profile/${tweet.author.username}`);
                            }}
                        >
                            {tweet.author.username}
                        </span>
                        {tweet.author.isVerified && (
                            <CheckCircle size={14} className="text-accent-blue fill-accent-blue flex-shrink-0" />
                        )}
                        <span className="text-xs text-text-muted">@{tweet.author.username}</span>
                        <span className="text-xs text-text-muted">· {formatTime(tweet.createdAt)}</span>
                    </div>

                    {isAuthor ? (
                        <button
                            onClick={handleDelete}
                            className="text-text-muted hover:text-red-400 p-1 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
                            title="Delete Post"
                        >
                            <Trash2 size={15} />
                        </button>
                    ) : (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                            }}
                            className="text-text-muted hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
                            title="More options"
                        >
                            <MoreHorizontal size={17} />
                        </button>
                    )}
                </div>

                {/* Content */}
                <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap break-words">
                    {renderContentWithHashtags(tweet.content)}
                </p>

                {/* Media preview (Standardized 1, 2, 3, 4, 4+ grid with +N overlay) */}
                {mediaList.length > 0 && (
                    <div
                        className={`tweet-media-grid count-${Math.min(mediaList.length, 4)} mt-3 rounded-2xl overflow-hidden border border-white/10 bg-black`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {mediaList.slice(0, 4).map((item, idx) => {
                            const isExtraTile = idx === 3 && mediaList.length > 4;
                            const remainingCount = mediaList.length - 4;

                            return (
                                <div
                                    key={item.id || idx}
                                    className="tweet-media-cell relative w-full h-full overflow-hidden bg-surface-secondary"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setLightboxIndex(idx);
                                        setLightboxOpen(true);
                                    }}
                                >
                                    {item.mediaType === "VIDEO" ? (
                                        <video
                                            controls
                                            playsInline
                                            preload="metadata"
                                            className="w-full h-full object-cover block"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <source src={getMediaUrl(item.url)} />
                                            Your browser does not support video playback.
                                        </video>
                                    ) : (
                                        <img
                                            src={getMediaUrl(item.url)}
                                            alt={`Attachment ${idx + 1}`}
                                            loading="lazy"
                                            className="w-full h-full object-cover block hover:scale-102 transition-transform cursor-pointer"
                                        />
                                    )}

                                    {/* +N Overlay on the 4th tile when more than 4 attachments */}
                                    {isExtraTile && (
                                        <div
                                            className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center text-white text-2xl font-extrabold cursor-pointer hover:bg-black/45 transition-colors z-10"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setLightboxIndex(3);
                                                setLightboxOpen(true);
                                            }}
                                        >
                                            <span>+{remainingCount + 1}</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Engagement Action Bar */}
                <div className="flex justify-between max-w-[420px] mt-3 text-text-muted">
                    {/* Reply */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (onOpenReply) onOpenReply(tweet);
                            else navigate(`/tweet/${tweet.id}`);
                        }}
                        className="flex items-center gap-1.5 text-xs hover:text-accent-blue p-1.5 rounded-full hover:bg-accent-blue/10 transition-colors cursor-pointer"
                    >
                        <MessageCircle size={17} />
                        <span>{tweet._count.replies || 0}</span>
                    </button>

                    {/* Retweet */}
                    <button
                        onClick={handleRetweet}
                        className={`flex items-center gap-1.5 text-xs hover:text-emerald-400 p-1.5 rounded-full hover:bg-emerald-500/10 transition-colors cursor-pointer ${
                            isRetweeted ? "text-emerald-400" : ""
                        }`}
                    >
                        <Repeat size={17} />
                        <span>{retweetsCount}</span>
                    </button>

                    {/* Like */}
                    <button
                        onClick={handleLike}
                        className={`flex items-center gap-1.5 text-xs hover:text-pink-500 p-1.5 rounded-full hover:bg-pink-500/10 transition-colors cursor-pointer ${
                            isLiked ? "text-pink-500" : ""
                        }`}
                    >
                        <Heart
                            size={17}
                            fill={isLiked ? "rgb(236 72 153)" : "transparent"}
                        />
                        <span>{likesCount}</span>
                    </button>

                    {/* Bookmark */}
                    <button
                        onClick={handleBookmark}
                        className={`flex items-center gap-1.5 text-xs hover:text-accent-blue p-1.5 rounded-full hover:bg-accent-blue/10 transition-colors cursor-pointer ${
                            isBookmarked ? "text-accent-blue" : ""
                        }`}
                    >
                        <Bookmark
                            size={17}
                            fill={isBookmarked ? "#1d9bf0" : "transparent"}
                        />
                    </button>

                    {/* Share */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(window.location.origin + `/tweet/${tweet.id}`);
                            alert("Link copied to clipboard!");
                        }}
                        className="flex items-center gap-1.5 text-xs hover:text-accent-blue p-1.5 rounded-full hover:bg-accent-blue/10 transition-colors cursor-pointer"
                    >
                        <Share2 size={16} />
                    </button>
                </div>
            </div>

            {/* Fullscreen Media Gallery Lightbox */}
            <MediaLightboxModal
                isOpen={lightboxOpen}
                media={mediaList.map((m) => ({ ...m, url: getMediaUrl(m.url) }))}
                initialIndex={lightboxIndex}
                onClose={() => setLightboxOpen(false)}
            />
        </article>
    );
};
