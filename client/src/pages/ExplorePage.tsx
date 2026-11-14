import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Loader2, TrendingUp, Hash, X, AlertCircle, ArrowLeft } from "lucide-react";
import { api } from "../api/client";
import { TweetCard } from "../components/TweetCard";
import { Pagination } from "../components/Pagination";
import { TweetSkeleton } from "../components/TweetSkeleton";
import type { Tweet, TrendingTopic } from "../types";

export const ExplorePage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const tagQuery = searchParams.get("tag") || "";
    const rawPage = parseInt(searchParams.get("page") || "1", 10);
    const currentPage = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

    const [searchTerm, setSearchTerm] = useState(tagQuery);
    const [tweets, setTweets] = useState<Tweet[]>([]);
    const [totalCount, setTotalCount] = useState<number>(0);
    const [totalPages, setTotalPages] = useState<number>(1);
    const [trends, setTrends] = useState<TrendingTopic[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [trendsLoading, setTrendsLoading] = useState(false);
    const [trendsError, setTrendsError] = useState<string | null>(null);

    const limit = 10;

    // Fetch trending hashtags when not filtering by tag
    const fetchTrends = useCallback(async () => {
        setTrendsLoading(true);
        setTrendsError(null);
        try {
            const { data } = await api.get("/tweets/trending?limit=15");
            setTrends(data.trends || []);
        } catch (err: any) {
            console.error("Error fetching trending hashtags:", err);
            const msg =
                err?.code === "ECONNABORTED"
                    ? "Request timed out while loading trends. Please try again."
                    : err?.response?.data?.error || "Unable to load trending topics. Please check your connection.";
            setTrendsError(msg);
            setTrends([]);
        } finally {
            setTrendsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!tagQuery) {
            setSearchTerm("");
            fetchTrends();
        }
    }, [tagQuery, fetchTrends]);

    // Fetch tweets for the selected tag & page
    const fetchHashtagTweets = useCallback(async () => {
        if (!tagQuery) {
            setTweets([]);
            setTotalCount(0);
            setTotalPages(1);
            setError(null);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const offset = (currentPage - 1) * limit;
            const cleanTag = encodeURIComponent(tagQuery.replace(/^#/, "").trim().toLowerCase());
            const { data } = await api.get(
                `/tweets/hashtag/${cleanTag}?limit=${limit}&offset=${offset}&page=${currentPage}`
            );

            const receivedTweets: Tweet[] = data.tweets || [];
            const receivedTotal: number = data.pagination?.totalCount ?? 0;
            const calculatedTotalPages = Math.max(1, Math.ceil(receivedTotal / limit));

            setTweets(receivedTweets);
            setTotalCount(receivedTotal);
            setTotalPages(calculatedTotalPages);
        } catch (err: any) {
            console.error("Error fetching hashtag tweets:", err);
            const msg =
                err?.code === "ECONNABORTED"
                    ? "Request timed out while loading hashtag posts. Please try again."
                    : err?.response?.data?.error || `Unable to load posts for #${tagQuery}. Please try again.`;
            setError(msg);
            setTweets([]);
            setTotalCount(0);
            setTotalPages(1);
        } finally {
            setLoading(false);
        }
    }, [tagQuery, currentPage, limit]);

    useEffect(() => {
        setSearchTerm(tagQuery);
        fetchHashtagTweets();
    }, [tagQuery, currentPage, fetchHashtagTweets]);

    const scrollToTop = () => {
        const centerCol = document.querySelector(".center-column");
        if (centerCol) {
            centerCol.scrollTo({ top: 0, behavior: "smooth" });
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const clean = searchTerm.replace(/^#/, "").trim().toLowerCase();
        if (clean) {
            setSearchParams({ tag: clean, page: "1" });
            scrollToTop();
        }
    };

    const handleClearSearch = () => {
        setSearchTerm("");
        setSearchParams({});
    };

    const handlePageChange = (newPage: number) => {
        if (newPage === currentPage || newPage < 1 || newPage > totalPages) return;
        setSearchParams({ tag: tagQuery, page: String(newPage) });
        scrollToTop();
    };

    const handleTagClick = (tag: string) => {
        setSearchParams({ tag, page: "1" });
        scrollToTop();
    };

    return (
        <main className="center-column w-full md:w-[630px] min-h-screen md:min-h-0 md:h-full md:overflow-y-auto md:overflow-x-hidden relative border-r border-border-dark flex-shrink-0 md:scroll-smooth">
            {/* Search Header */}
            <div className="sticky top-0 z-20 bg-black/90 backdrop-blur-md border-b border-border-dark p-3">
                <form onSubmit={handleSearchSubmit}>
                    <div className="relative">
                        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                        <input
                            type="text"
                            placeholder="Search hashtag (e.g. react, webdev)..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-surface-card border border-border-dark rounded-full py-2.5 pl-10 pr-10 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:bg-black focus:outline-none focus:ring-1 focus:ring-accent-blue transition-all"
                        />
                        {tagQuery && (
                            <button
                                type="button"
                                onClick={handleClearSearch}
                                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-white p-1 cursor-pointer"
                                aria-label="Clear search"
                            >
                                <X size={18} />
                            </button>
                        )}
                    </div>
                </form>
            </div>

            {/* Results or Trending Topics */}
            {tagQuery ? (
                <div>
                    <div className="p-4 border-b border-border-dark flex justify-between items-center bg-black/40">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleClearSearch}
                                className="text-text-muted hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
                                title="Back to Trending"
                            >
                                <ArrowLeft size={19} />
                            </button>
                            <div>
                                <h2 className="text-xl font-extrabold text-white">#{tagQuery}</h2>
                                <span className="text-xs text-text-muted">
                                    {totalCount} {totalCount === 1 ? "post" : "posts"} found
                                </span>
                            </div>
                        </div>
                        <button
                            onClick={handleClearSearch}
                            className="text-xs text-accent-blue hover:underline cursor-pointer"
                        >
                            View all trends
                        </button>
                    </div>

                    {loading ? (
                        <TweetSkeleton count={4} />
                    ) : error ? (
                        <div className="py-14 px-5 text-center text-text-secondary">
                            <AlertCircle size={36} className="text-red-500 mx-auto mb-3" />
                            <h3 className="text-base text-text-primary font-bold mb-2">
                                {error}
                            </h3>
                            <button
                                onClick={fetchHashtagTweets}
                                className="mt-3 bg-surface-secondary hover:bg-surface-hover border border-border-dark text-white font-bold text-xs py-2 px-4 rounded-full transition-all cursor-pointer"
                            >
                                Retry
                            </button>
                        </div>
                    ) : tweets.length === 0 ? (
                        <div className="py-16 px-5 text-center text-text-secondary">
                            <Hash size={40} className="text-text-muted mx-auto mb-3" />
                            <h3 className="text-base text-text-primary font-bold mb-1.5">
                                No posts found with #{tagQuery}
                            </h3>
                            <p className="text-sm text-text-muted">
                                Be the first to use this hashtag in a post!
                            </p>
                        </div>
                    ) : (
                        <div>
                            {tweets.map((t) => (
                                <TweetCard key={t.id} tweet={t} />
                            ))}

                            {/* Page-by-Page Numbered Pagination for Hashtag Feed */}
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
                </div>
            ) : (
                <div className="p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <TrendingUp size={22} className="text-accent-blue" />
                        <h3 className="text-xl font-extrabold text-text-primary">
                            Trending on SocialSphere
                        </h3>
                    </div>

                    {trendsLoading ? (
                        <div className="flex justify-center py-10">
                            <Loader2 size={28} className="animate-spin text-accent-blue" />
                        </div>
                    ) : trendsError ? (
                        <div className="p-8 text-center bg-surface-secondary rounded-2xl border border-border-dark">
                            <AlertCircle size={36} className="text-red-500 mx-auto mb-3" />
                            <h4 className="text-base text-text-primary font-bold mb-1.5">
                                {trendsError}
                            </h4>
                            <button
                                onClick={fetchTrends}
                                className="mt-3 bg-surface-card hover:bg-surface-hover border border-border-dark text-white font-bold text-xs py-2 px-4 rounded-full transition-all cursor-pointer"
                            >
                                Retry
                            </button>
                        </div>
                    ) : trends.length === 0 ? (
                        <div className="p-8 text-center bg-surface-secondary rounded-2xl border border-border-dark">
                            <TrendingUp size={36} className="text-text-muted mx-auto mb-3" />
                            <h4 className="text-base text-text-primary font-bold mb-1.5">
                                No trending hashtags yet
                            </h4>
                            <p className="text-sm text-text-muted max-w-xs mx-auto">
                                Start the conversation by adding #hashtags to your thoughts and replies.
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-border-dark -mx-5 border-t border-border-dark">
                            {trends.map((item, index) => (
                                <div
                                    key={item.id}
                                    onClick={() => handleTagClick(item.tag)}
                                    className="px-5 py-3.5 hover:bg-white/[0.03] cursor-pointer transition-colors group flex items-center justify-between"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1.5 text-xs text-text-muted">
                                            <span>Trending #{index + 1}</span>
                                            <span>·</span>
                                            <span>SocialSphere</span>
                                        </div>
                                        <div className="text-base font-bold text-white group-hover:text-accent-blue group-hover:underline transition-colors mt-0.5">
                                            #{item.tag}
                                        </div>
                                        <div className="text-xs text-text-muted mt-0.5">
                                            {item.tweetCount} {item.tweetCount === 1 ? "post" : "posts"}
                                        </div>
                                    </div>
                                    <div className="p-2 text-text-muted group-hover:text-white rounded-full hover:bg-white/10 transition-colors">
                                        <Hash size={18} className="text-accent-blue/60 group-hover:text-accent-blue transition-colors" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </main>
    );
};
