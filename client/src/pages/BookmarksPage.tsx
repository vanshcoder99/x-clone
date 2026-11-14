import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Bookmark } from "lucide-react";
import { api } from "../api/client";
import { TweetCard } from "../components/TweetCard";
import { Pagination } from "../components/Pagination";
import { TweetSkeleton } from "../components/TweetSkeleton";
import { useAuth } from "../features/auth/hooks";
import type { Tweet } from "../types";

export const BookmarksPage: React.FC = () => {
    const { user } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    const rawPage = parseInt(searchParams.get("page") || "1", 10);
    const currentPage = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

    const [bookmarks, setBookmarks] = useState<Tweet[]>([]);
    const [totalCount, setTotalCount] = useState<number>(0);
    const [totalPages, setTotalPages] = useState<number>(1);
    const [loading, setLoading] = useState(true);

    const limit = 10;

    useEffect(() => {
        const fetchBookmarks = async () => {
            if (!user) {
                setLoading(false);
                return;
            }

            setLoading(true);
            try {
                const offset = (currentPage - 1) * limit;
                const { data } = await api.get(`/tweets/bookmarks?limit=${limit}&offset=${offset}`);
                const received = data.tweets || [];
                const receivedTotal = data.pagination?.totalCount ?? received.length;

                setBookmarks(received);
                setTotalCount(receivedTotal);
                setTotalPages(Math.max(1, Math.ceil(receivedTotal / limit)));
            } catch (err) {
                console.error("Error fetching bookmarks:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchBookmarks();
    }, [user, currentPage]);

    const handlePageChange = (newPage: number) => {
        if (newPage === currentPage || newPage < 1 || newPage > totalPages) return;
        setSearchParams({ page: String(newPage) });
        const centerCol = document.querySelector(".center-column");
        if (centerCol) {
            centerCol.scrollTo({ top: 0, behavior: "smooth" });
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    return (
        <main className="center-column w-full md:w-[630px] min-h-screen md:min-h-0 md:h-full md:overflow-y-auto md:overflow-x-hidden relative border-r border-border-dark flex-shrink-0 md:scroll-smooth">
            {/* Header */}
            <div className="sticky top-0 z-20 bg-black/90 backdrop-blur-md border-b border-border-dark px-5 py-3.5">
                <div className="flex items-center gap-2">
                    <Bookmark size={22} className="text-accent-blue" />
                    <h2 className="text-xl font-extrabold text-white">Bookmarks</h2>
                </div>
                <span className="text-xs text-text-muted">
                    @{user?.username || "guest"}
                </span>
            </div>

            {loading ? (
                <TweetSkeleton count={4} />
            ) : bookmarks.length === 0 ? (
                <div className="py-20 px-5 text-center text-text-secondary">
                    <h3 className="text-xl font-bold text-text-primary mb-2">
                        Save posts for later
                    </h3>
                    <p className="max-w-xs mx-auto text-sm text-text-muted">
                        Don't let the good ones fly away! Bookmark posts to easily find them again in the future.
                    </p>
                </div>
            ) : (
                <div>
                    {bookmarks.map((t) => (
                        <TweetCard
                            key={t.id}
                            tweet={t}
                            onDelete={(deletedId) =>
                                setBookmarks((prev) => prev.filter((b) => b.id !== deletedId))
                            }
                        />
                    ))}

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
        </main>
    );
};
