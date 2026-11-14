import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Composer } from "../components/Composer";
import { TweetCard } from "../components/TweetCard";
import { ReplyModal } from "../components/ReplyModal";
import { Pagination } from "../components/Pagination";
import { TweetSkeleton } from "../components/TweetSkeleton";
import { useAuth } from "../features/auth/hooks";
import { useSocket } from "../features/socket/hooks";
import type { Tweet } from "../types";
import { AlertCircle, Feather, Sun, Moon } from "lucide-react";
import { useTheme } from "../features/theme/hooks";
import logoImg from "../assets/socialsphere-mark.svg";

export const FeedPage: React.FC = () => {
    const { user } = useAuth();
    const { theme, toggleTheme } = useTheme();
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

    // Component state
    const [tweets, setTweets] = useState<Tweet[]>([]);
    const [totalCount, setTotalCount] = useState<number>(0);
    const [totalPages, setTotalPages] = useState<number>(1);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [replyingTweet, setReplyingTweet] = useState<Tweet | null>(null);

    const limit = 10;

    // Unified Data Fetcher for Page-by-Page Feed
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

            // Strictly replace the page content (page-by-page semantics)
            setTweets(receivedTweets);
            setTotalCount(receivedTotal);
            setTotalPages(calculatedTotalPages);
        } catch (err: any) {
            console.error("Error loading feed:", err);
            const msg =
                err?.code === "ECONNABORTED"
                    ? "Request timed out while loading posts. Please check your connection."
                    : err?.response?.data?.error || "Failed to load posts. Please try again.";
            setError(msg);
            setTweets([]);
            setTotalCount(0);
            setTotalPages(1);
        } finally {
            setLoading(false);
        }
    }, [activeTab, currentPage, limit]);

    // Fetch posts whenever tab or page changes
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
        <main className="center-column w-full md:w-[630px] min-h-screen md:min-h-0 md:h-full md:overflow-y-auto md:overflow-x-hidden relative border-r border-border-dark flex-shrink-0 md:scroll-smooth">
            {/* Header with For You / Following tabs */}
            <div className="feed-header sticky top-0 z-30 bg-black/90 backdrop-blur-md border-b border-border-dark w-full">
                {/* Mobile Top Header (Visible on < 768px, Reference 3) */}
                <div className="flex md:hidden items-center justify-between px-4 py-2.5 border-b border-border-dark bg-black/90 backdrop-blur-md">
                    <div className="w-8">
                        {user ? (
                            <img
                                src={
                                    user.avatarUrl ||
                                    `https://api.dicebear.com/7.x/identicon/svg?seed=${user.username}`
                                }
                                alt={user.username}
                                className="w-8 h-8 rounded-full object-cover cursor-pointer"
                                onClick={() => navigate(`/profile/${user.username}`)}
                            />
                        ) : (
                            <button
                                onClick={() => navigate("/auth")}
                                className="bg-transparent text-accent-blue border border-accent-blue rounded-full px-3 py-1 text-xs font-bold cursor-pointer"
                            >
                                Sign in
                            </button>
                        )}
                    </div>
                    <div
                        className="flex items-center gap-2 cursor-pointer"
                        onClick={() => handleTabChange("for-you")}
                    >
                        <div className="w-8 h-8 aspect-square rounded-full overflow-hidden bg-surface-primary border border-accent-blue/30 flex items-center justify-center p-1 flex-shrink-0 shadow-sm">
                            <img src={logoImg} alt="SocialSphere" className="w-full h-full object-contain rounded-full block" />
                        </div>
                        <span className="font-extrabold text-lg text-white tracking-tight">SocialSphere</span>
                    </div>
                    <button
                        onClick={toggleTheme}
                        className="w-8 h-8 flex items-center justify-center text-text-muted hover:text-white transition-colors cursor-pointer"
                        title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
                    >
                        {theme === "dark" ? (
                            <Sun size={19} className="text-amber-400" />
                        ) : (
                            <Moon size={19} className="text-accent-blue" />
                        )}
                    </button>
                </div>

                <div className="flex bg-transparent" role="tablist">
                    <button
                        role="tab"
                        aria-selected={activeTab === "for-you"}
                        className={`flex-1 py-3.5 text-center font-bold text-sm transition-colors relative cursor-pointer ${
                            activeTab === "for-you"
                                ? "text-white after:content-[''] after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2 after:w-16 after:h-1 after:bg-accent-blue after:rounded-full"
                                : "text-text-muted hover:text-gray-200 hover:bg-white/[0.03]"
                        }`}
                        onClick={() => handleTabChange("for-you")}
                    >
                        For You
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeTab === "following"}
                        className={`flex-1 py-3.5 text-center font-bold text-sm transition-colors relative cursor-pointer ${
                            activeTab === "following"
                                ? "text-white after:content-[''] after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2 after:w-16 after:h-1 after:bg-accent-blue after:rounded-full"
                                : "text-text-muted hover:text-gray-200 hover:bg-white/[0.03]"
                        }`}
                        onClick={() => handleTabChange("following")}
                    >
                        Following
                    </button>
                </div>
            </div>

            {/* Composer Box (Visible if logged in) */}
            {user && <Composer onTweetPosted={handleTweetPosted} />}

            {/* Floating Live Tweet Banner (Socket.IO Real-Time) */}
            {latestTweet && (
                <div
                    onClick={handleLoadNewTweet}
                    className="sticky top-16 z-20 flex justify-center my-2.5"
                >
                    <button className="bg-accent-blue hover:bg-accent-blue-hover text-white rounded-full py-2 px-5 text-xs font-bold shadow-lg shadow-accent-blue/35 transition-all cursor-pointer flex items-center gap-1.5">
                        ✨ New post from @{latestTweet.author.username} — Click to view
                    </button>
                </div>
            )}

            {/* Loading State - Skeleton Pulse Loaders */}
            {loading ? (
                <TweetSkeleton count={4} />
            ) : error ? (
                <div className="py-14 px-5 text-center text-text-secondary">
                    <AlertCircle size={36} className="text-red-500 mx-auto mb-3" />
                    <h3 className="text-base text-text-primary font-bold mb-2">
                        {error}
                    </h3>
                    <button
                        onClick={() => fetchFeed()}
                        className="mt-3 bg-surface-secondary hover:bg-surface-hover border border-border-dark text-white font-bold text-sm py-2 px-5 rounded-full transition-all cursor-pointer"
                    >
                        Try Again
                    </button>
                </div>
            ) : tweets.length === 0 ? (
                <div className="py-16 px-5 text-center text-text-secondary">
                    <h3 className="text-lg font-bold text-text-primary mb-2">
                        {activeTab === "following" ? "Welcome to your timeline!" : "No posts yet"}
                    </h3>
                    <p className="max-w-xs mx-auto text-sm text-text-muted">
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
                    className="md:hidden fixed bottom-20 right-4 w-13 h-13 rounded-full bg-gradient-to-r from-accent-blue to-accent-blue-hover text-white flex items-center justify-center shadow-xl shadow-accent-blue/40 z-40 border-none cursor-pointer active:scale-95 transition-transform"
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
