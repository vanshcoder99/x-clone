import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Composer } from "../components/Composer";
import { TweetCard } from "../components/TweetCard";
import { ReplyModal } from "../components/ReplyModal";
import { Pagination } from "../components/Pagination";
import { TweetSkeleton } from "../components/TweetSkeleton";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import type { Tweet } from "../types";
import { AlertCircle, Feather } from "lucide-react";
import logoImg from "../assets/logo.png";

export const FeedPage: React.FC = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const { latestTweet, clearLatestTweet } = useSocket();
    const [searchParams, setSearchParams] = useSearchParams();

    // Tab state synchronized with URL search params
    const tabParam = searchParams.get("tab");
    const activeTab: "for-you" | "following" =
        tabParam === "following" && user ? "following" : "for-you";

    // 1-indexed Page state synchronized with URL search params
    const rawPage = parseInt(searchParams.get("page") || "1", 10);
    const currentPage = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

    const [tweets, setTweets] = useState<Tweet[]>([]);
    const [totalCount, setTotalCount] = useState<number>(0);
    const [totalPages, setTotalPages] = useState<number>(1);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const [replyingTweet, setReplyingTweet] = useState<Tweet | null>(null);

    const limit = 10;

    // Fetch feed for the selected page & tab (replaces existing page entirely)
    const fetchFeed = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const offset = (currentPage - 1) * limit;
            const { data } = await api.get(
                `/tweets/feed?type=${activeTab}&limit=${limit}&offset=${offset}&page=${currentPage}`
            );

            const receivedTweets: Tweet[] = data.tweets || [];
            const receivedTotal: number = data.pagination?.totalCount ?? 0;
            const calculatedTotalPages = Math.max(1, Math.ceil(receivedTotal / limit));

            setTweets(receivedTweets);
            setTotalCount(receivedTotal);
            setTotalPages(calculatedTotalPages);

            // Handle edge case: if current page exceeds total pages after data changes, navigate to last valid page
            if (currentPage > calculatedTotalPages && calculatedTotalPages > 0) {
                setSearchParams({ tab: activeTab, page: String(calculatedTotalPages) });
            }
        } catch (err: any) {
            console.error("Error fetching feed:", err);
            const msg =
                err?.code === "ECONNABORTED"
                    ? "Request timed out while loading posts. Please try again."
                    : err?.response?.data?.error || "Unable to load posts at this time. Please try again.";
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [activeTab, currentPage, limit, setSearchParams]);

    useEffect(() => {
        fetchFeed();
    }, [fetchFeed]);

    // Helper: smooth scroll to top of center column (or window on mobile)
    const scrollToTop = () => {
        const centerCol = document.querySelector(".center-column");
        if (centerCol) {
            centerCol.scrollTo({ top: 0, behavior: "smooth" });
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    // Handle Tab switching - ALWAYS resets page to 1
    const handleTabChange = (newTab: "for-you" | "following") => {
        if (newTab === activeTab) return;
        setSearchParams({ tab: newTab, page: "1" });
        scrollToTop();
    };

    // Handle Page Selection - replaces current page
    const handlePageChange = (newPage: number) => {
        if (newPage === currentPage || newPage < 1 || newPage > totalPages) return;
        setSearchParams({ tab: activeTab, page: String(newPage) });
        scrollToTop();
    };

    // Handle new post from local composer
    const handleTweetPosted = (newTweet: Tweet) => {
        if (currentPage === 1) {
            // Keep exactly `limit` posts on page 1
            setTweets((prev) => [newTweet, ...prev.slice(0, limit - 1)]);
            const newTotal = totalCount + 1;
            setTotalCount(newTotal);
            setTotalPages(Math.max(1, Math.ceil(newTotal / limit)));
        } else {
            // If on another page, navigate to page 1 to see the new post
            setSearchParams({ tab: activeTab, page: "1" });
        }
    };

    // Handle post deletion
    const handleTweetDeleted = (deletedId: string) => {
        setTweets((prev) => {
            const next = prev.filter((t) => t.id !== deletedId);
            // If this was the last tweet on page > 1, navigate back to previous valid page
            if (next.length === 0 && currentPage > 1) {
                setSearchParams({ tab: activeTab, page: String(currentPage - 1) });
            }
            return next;
        });

        const newTotal = Math.max(0, totalCount - 1);
        setTotalCount(newTotal);
        setTotalPages(Math.max(1, Math.ceil(newTotal / limit)));
    };

    // Socket.IO notification click: navigates to page 1 or refreshes page 1
    const handleLoadNewTweet = () => {
        clearLatestTweet();
        if (currentPage === 1) {
            fetchFeed();
        } else {
            setSearchParams({ tab: activeTab, page: "1" });
        }
        scrollToTop();
    };

    return (
        <main className="center-column">
            {/* Header with For You / Following tabs */}
            <div className="feed-header">
                {/* Mobile Top Header (Visible on < 768px, Reference 3) */}
                <div className="mobile-top-bar">
                    <div className="mobile-top-left">
                        {user ? (
                            <img
                                src={
                                    user.avatarUrl ||
                                    `https://api.dicebear.com/7.x/identicon/svg?seed=${user.username}`
                                }
                                alt={user.username}
                                className="mobile-top-avatar"
                                onClick={() => navigate(`/profile/${user.username}`)}
                            />
                        ) : (
                            <button
                                onClick={() => navigate("/auth")}
                                className="mobile-top-signin"
                            >
                                Sign in
                            </button>
                        )}
                    </div>
                    <div className="mobile-top-brand" onClick={() => handleTabChange("for-you")}>
                        <div className="mobile-top-logo-wrapper">
                            <img src={logoImg} alt="SocialSphere" className="mobile-top-logo" />
                        </div>
                        <span className="mobile-top-title">SocialSphere</span>
                    </div>
                    <div className="mobile-top-right" />
                </div>

                <div className="feed-tabs" role="tablist">
                    <button
                        role="tab"
                        aria-selected={activeTab === "for-you"}
                        className={`feed-tab ${activeTab === "for-you" ? "active" : ""}`}
                        onClick={() => handleTabChange("for-you")}
                    >
                        For you
                    </button>
                    {user && (
                        <button
                            role="tab"
                            aria-selected={activeTab === "following"}
                            className={`feed-tab ${activeTab === "following" ? "active" : ""}`}
                            onClick={() => handleTabChange("following")}
                        >
                            Following
                        </button>
                    )}
                </div>
            </div>

            {/* Composer Box (Visible if logged in) */}
            {user && <Composer onTweetPosted={handleTweetPosted} />}

            {/* Floating Live Tweet Banner (Socket.IO Real-Time) */}
            {latestTweet && (
                <div
                    onClick={handleLoadNewTweet}
                    style={{
                        position: "sticky",
                        top: "60px",
                        zIndex: 15,
                        display: "flex",
                        justifyContent: "center",
                        margin: "10px 0",
                    }}
                >
                    <button
                        className="tweet-btn-large"
                        style={{
                            borderRadius: "9999px",
                            padding: "8px 20px",
                            fontSize: "0.85rem",
                            boxShadow: "0 6px 20px rgba(29, 155, 240, 0.4)",
                            cursor: "pointer",
                        }}
                    >
                        ✨ New post from @{latestTweet.author.username} — Click to view
                    </button>
                </div>
            )}

            {/* Loading State - Skeleton Pulse Loaders */}
            {loading ? (
                <TweetSkeleton count={4} />
            ) : error ? (
                <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--text-secondary)" }}>
                    <AlertCircle size={36} color="#ef4444" style={{ margin: "0 auto 12px" }} />
                    <h3 style={{ fontSize: "1.15rem", color: "var(--text-primary)", marginBottom: "8px" }}>
                        {error}
                    </h3>
                    <button
                        onClick={() => fetchFeed()}
                        className="load-more-btn"
                        style={{ marginTop: "12px" }}
                    >
                        Try Again
                    </button>
                </div>
            ) : tweets.length === 0 ? (
                <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--text-secondary)" }}>
                    <h3 style={{ fontSize: "1.25rem", color: "var(--text-primary)", marginBottom: "8px" }}>
                        {activeTab === "following" ? "Welcome to your timeline!" : "No posts yet"}
                    </h3>
                    <p style={{ maxWidth: "340px", margin: "0 auto" }}>
                        {activeTab === "following"
                            ? "Follow some interesting creators to see their thoughts here."
                            : "Be the first to post a thought to SocialSphere!"}
                    </p>
                </div>
            ) : (
                <div>
                    {/* Render exact posts for the current page */}
                    {tweets.map((t) => (
                        <TweetCard
                            key={t.id}
                            tweet={t}
                            onDelete={handleTweetDeleted}
                            onOpenReply={(tweetToReply) => setReplyingTweet(tweetToReply)}
                        />
                    ))}

                    {/* Page-by-Page Numbered Pagination Control */}
                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        totalCount={totalCount}
                        limit={limit}
                        onPageChange={handlePageChange}
                        disabled={loading}
                    />
                </div>
            )}

            {/* Reply Modal */}
            <ReplyModal
                tweet={replyingTweet}
                onClose={() => setReplyingTweet(null)}
                onReplySuccess={() => {
                    // Update reply count or refresh if needed
                }}
            />

            {/* Mobile Floating Action Button (FAB) (Visible on < 768px, Reference 3) */}
            {user && (
                <button
                    className="mobile-fab"
                    onClick={() => {
                        window.scrollTo({ top: 0, behavior: "smooth" });
                        const input = document.querySelector(".composer-input") as HTMLTextAreaElement | null;
                        if (input) {
                            input.focus();
                        }
                    }}
                    aria-label="Create Post"
                >
                    <Feather size={22} color="#ffffff" />
                </button>
            )}
        </main>
    );
};
