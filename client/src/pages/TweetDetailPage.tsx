import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api } from "../api/client";
import { TweetCard } from "../components/TweetCard";
import { Composer } from "../components/Composer";
import { useAuth } from "../context/AuthContext";
import type { Tweet } from "../types";

export const TweetDetailPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const { user } = useAuth();
    const navigate = useNavigate();

    const [tweet, setTweet] = useState<Tweet | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchTweetThread = async () => {
            if (!id) return;
            setLoading(true);

            try {
                const { data } = await api.get(`/tweets/${id}`);
                setTweet(data.tweet);
            } catch (err) {
                console.error("Error fetching tweet thread:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchTweetThread();
    }, [id]);

    const handleReplyPosted = (newReply: Tweet) => {
        setTweet((prev) =>
            prev
                ? {
                      ...prev,
                      _count: {
                          ...prev._count,
                          replies: prev._count.replies + 1,
                      },
                      replies: [...(prev.replies || []), newReply],
                  }
                : null
        );
    };

    if (loading) {
        return (
            <main className="center-column w-full md:w-[630px] min-h-screen md:min-h-0 md:h-full md:overflow-y-auto md:overflow-x-hidden relative border-r border-border-dark flex-shrink-0 md:scroll-smooth flex justify-center py-16">
                <Loader2 size={32} className="animate-spin text-accent-blue" />
            </main>
        );
    }

    if (!tweet) {
        return (
            <main className="center-column w-full md:w-[630px] min-h-screen md:min-h-0 md:h-full md:overflow-y-auto md:overflow-x-hidden relative border-r border-border-dark flex-shrink-0 md:scroll-smooth py-16 px-5 text-center">
                <h2 className="text-xl font-bold text-white">Post not found</h2>
                <button
                    onClick={() => navigate(-1)}
                    className="mt-4 bg-accent-blue hover:bg-accent-blue-hover text-white font-bold text-sm py-2 px-5 rounded-full shadow-md transition-all cursor-pointer"
                >
                    Go Back
                </button>
            </main>
        );
    }

    return (
        <main className="center-column w-full md:w-[630px] min-h-screen md:min-h-0 md:h-full md:overflow-y-auto md:overflow-x-hidden relative border-r border-border-dark flex-shrink-0 md:scroll-smooth">
            {/* Header */}
            <div className="sticky top-0 z-20 bg-black/90 backdrop-blur-md border-b border-border-dark px-4 py-2.5 flex items-center gap-6">
                <button
                    onClick={() => navigate(-1)}
                    className="text-text-muted hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
                >
                    <ArrowLeft size={20} />
                </button>
                <h2 className="text-xl font-extrabold text-white">Thread</h2>
            </div>

            {/* Root Tweet */}
            <TweetCard
                tweet={tweet}
                onDelete={() => navigate("/")}
            />

            {/* Reply Composer */}
            {user && (
                <div className="border-b border-border-dark bg-surface-primary/20">
                    <Composer
                        parentTweetId={tweet.id}
                        placeholder="Post your reply"
                        onTweetPosted={handleReplyPosted}
                    />
                </div>
            )}

            {/* Threaded Replies List */}
            <div>
                {tweet.replies && tweet.replies.length > 0 ? (
                    tweet.replies.map((reply) => (
                        <TweetCard key={reply.id} tweet={reply} />
                    ))
                ) : (
                    <div className="py-14 px-5 text-center text-text-muted text-sm">
                        No replies yet. Be the first to reply!
                    </div>
                )}
            </div>
        </main>
    );
};
