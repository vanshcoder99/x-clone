import React, { useState, useEffect } from "react";
import { Bookmark, Loader2 } from "lucide-react";
import { api } from "../api/client";
import { TweetCard } from "../components/TweetCard";
import { useAuth } from "../context/AuthContext";
import type { Tweet } from "../types";

export const BookmarksPage: React.FC = () => {
    const { user } = useAuth();
    const [bookmarks, setBookmarks] = useState<Tweet[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchBookmarks = async () => {
            if (!user) {
                setLoading(false);
                return;
            }

            try {
                const { data } = await api.get("/tweets/bookmarks");
                setBookmarks(data.tweets || []);
            } catch (err) {
                console.error("Error fetching bookmarks:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchBookmarks();
    }, [user]);

    return (
        <main className="center-column">
            {/* Header */}
            <div
                style={{
                    padding: "16px 20px",
                    position: "sticky",
                    top: 0,
                    background: "rgba(0,0,0,0.85)",
                    backdropFilter: "blur(12px)",
                    zIndex: 20,
                    borderBottom: "1px solid var(--border-color)",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Bookmark size={22} color="var(--accent-blue)" />
                    <h2 style={{ fontSize: "1.25rem", fontWeight: 800 }}>Bookmarks</h2>
                </div>
                <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                    @{user?.username || "guest"}
                </span>
            </div>

            {loading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: "60px" }}>
                    <Loader2 size={32} className="animate-spin" color="var(--accent-blue)" />
                </div>
            ) : bookmarks.length === 0 ? (
                <div style={{ padding: "80px 20px", textAlign: "center", color: "var(--text-secondary)" }}>
                    <h3 style={{ fontSize: "1.3rem", color: "var(--text-primary)", marginBottom: "8px" }}>
                        Save posts for later
                    </h3>
                    <p style={{ maxWidth: "340px", margin: "0 auto" }}>
                        Don't let the good ones fly away! Bookmark posts to easily find them again in the future.
                    </p>
                </div>
            ) : (
                bookmarks.map((t) => <TweetCard key={t.id} tweet={t} />)
            )}
        </main>
    );
};
