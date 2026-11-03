import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Loader2, TrendingUp, Hash, X } from "lucide-react";
import { api } from "../api/client";
import { TweetCard } from "../components/TweetCard";
import { Pagination } from "../components/Pagination";
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
    const [trendsLoading, setTrendsLoading] = useState(false);

    const limit = 10;

    // Fetch trending hashtags when not filtering by tag
    useEffect(() => {
        if (!tagQuery) {
            setSearchTerm("");
            const fetchTrends = async () => {
                setTrendsLoading(true);
                try {
                    const { data } = await api.get("/tweets/trending?limit=15");
                    setTrends(data.trends || []);
                } catch (err) {
                    console.error("Error fetching trending hashtags:", err);
                    setTrends([]);
                } finally {
                    setTrendsLoading(false);
                }
            };
            fetchTrends();
        }
    }, [tagQuery]);

    // Fetch tweets for the selected tag & page
    useEffect(() => {
        if (!tagQuery) {
            setTweets([]);
            setTotalCount(0);
            setTotalPages(1);
            return;
        }

        setSearchTerm(tagQuery);
        let isCancelled = false;

        const fetchHashtagTweets = async () => {
            setLoading(true);
            try {
                const offset = (currentPage - 1) * limit;
                const cleanTag = encodeURIComponent(tagQuery.replace(/^#/, "").trim().toLowerCase());
                const { data } = await api.get(
                    `/tweets/hashtag/${cleanTag}?limit=${limit}&offset=${offset}&page=${currentPage}`
                );

                if (isCancelled) return;

                const receivedTweets: Tweet[] = data.tweets || [];
                const receivedTotal: number = data.pagination?.totalCount ?? 0;
                const calculatedTotalPages = Math.max(1, Math.ceil(receivedTotal / limit));

                setTweets(receivedTweets);
                setTotalCount(receivedTotal);
                setTotalPages(calculatedTotalPages);
            } catch (err) {
                if (isCancelled) return;
                console.error("Error fetching hashtag tweets:", err);
                setTweets([]);
                setTotalCount(0);
                setTotalPages(1);
            } finally {
                if (!isCancelled) {
                    setLoading(false);
                }
            }
        };

        fetchHashtagTweets();

        return () => {
            isCancelled = true;
        };
    }, [tagQuery, currentPage]);

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const clean = searchTerm.replace(/^#/, "").trim().toLowerCase();
        if (clean) {
            setSearchParams({ tag: clean, page: "1" });
            window.scrollTo({ top: 0, behavior: "smooth" });
        }
    };

    const handleClearSearch = () => {
        setSearchTerm("");
        setSearchParams({});
    };

    const handlePageChange = (newPage: number) => {
        if (newPage === currentPage || newPage < 1 || newPage > totalPages) return;
        setSearchParams({ tag: tagQuery, page: String(newPage) });
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const handleTagClick = (tag: string) => {
        setSearchParams({ tag, page: "1" });
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    return (
        <main className="center-column">
            {/* Search Header */}
            <div
                style={{
                    padding: "12px 16px",
                    position: "sticky",
                    top: 0,
                    background: "rgba(0,0,0,0.85)",
                    backdropFilter: "blur(12px)",
                    zIndex: 20,
                    borderBottom: "1px solid var(--border-color)",
                }}
            >
                <form onSubmit={handleSearchSubmit}>
                    <div className="search-bar-container">
                        <Search size={18} className="search-icon" />
                        <input
                            type="text"
                            placeholder="Search hashtag (e.g. react, webdev)..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="search-input"
                        />
                        {tagQuery && (
                            <button
                                type="button"
                                onClick={handleClearSearch}
                                style={{
                                    position: "absolute",
                                    right: "12px",
                                    background: "transparent",
                                    border: "none",
                                    color: "var(--text-muted)",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                }}
                                aria-label="Clear search"
                            >
                                <X size={18} />
                            </button>
                        )}
                    </div>
                </form>
            </div>

            {/* Results or Trending Topics */}
            {loading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: "60px" }}>
                    <Loader2 size={32} className="animate-spin" color="var(--accent-blue)" />
                </div>
            ) : tagQuery ? (
                <div>
                    <div
                        style={{
                            padding: "16px 20px",
                            borderBottom: "1px solid var(--border-color)",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                        }}
                    >
                        <div>
                            <h2 style={{ fontSize: "1.25rem", fontWeight: 800 }}>#{tagQuery}</h2>
                            <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                                {totalCount} {totalCount === 1 ? "post" : "posts"} found
                            </span>
                        </div>
                    </div>

                    {tweets.length === 0 ? (
                        <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--text-secondary)" }}>
                            <Hash size={40} color="var(--text-muted)" style={{ margin: "0 auto 12px" }} />
                            <h3 style={{ fontSize: "1.1rem", color: "var(--text-primary)", marginBottom: "6px" }}>
                                No posts found with #{tagQuery}
                            </h3>
                            <p style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
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
                <div style={{ padding: "24px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                        <TrendingUp size={22} color="var(--accent-blue)" />
                        <h3 style={{ fontSize: "1.25rem", color: "var(--text-primary)", fontWeight: 800, margin: 0 }}>
                            Trending on SocialSphere
                        </h3>
                    </div>

                    {trendsLoading ? (
                        <div style={{ display: "flex", justifyContent: "center", padding: "40px" }}>
                            <Loader2 size={28} className="animate-spin" color="var(--accent-blue)" />
                        </div>
                    ) : trends.length === 0 ? (
                        <div
                            style={{
                                padding: "48px 20px",
                                textAlign: "center",
                                background: "var(--bg-secondary)",
                                borderRadius: "14px",
                                border: "1px solid var(--border-color)",
                            }}
                        >
                            <TrendingUp size={36} color="var(--text-muted)" style={{ margin: "0 auto 12px" }} />
                            <h4 style={{ fontSize: "1.05rem", color: "var(--text-primary)", marginBottom: "6px" }}>
                                No trending hashtags yet
                            </h4>
                            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", maxWidth: "340px", margin: "0 auto" }}>
                                Start the conversation by adding #hashtags to your thoughts and replies.
                            </p>
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                            {trends.map((item, index) => (
                                <div
                                    key={item.id}
                                    onClick={() => handleTagClick(item.tag)}
                                    style={{
                                        padding: "14px 18px",
                                        backgroundColor: "var(--bg-secondary)",
                                        border: "1px solid var(--border-color)",
                                        borderRadius: "14px",
                                        cursor: "pointer",
                                        transition: "all 0.2s ease",
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                                        e.currentTarget.style.borderColor = "var(--accent-blue)";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = "var(--bg-secondary)";
                                        e.currentTarget.style.borderColor = "var(--border-color)";
                                    }}
                                >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                                            Trending #{index + 1}
                                        </span>
                                        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                                            {item.tweetCount} {item.tweetCount === 1 ? "post" : "posts"}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text-primary)", marginTop: "4px" }}>
                                        #{item.tag}
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
