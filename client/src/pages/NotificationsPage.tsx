import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
    Heart,
    Repeat,
    UserPlus,
    MessageCircle,
    CheckCheck,
    Loader2,
    AlertCircle,
    Bell,
} from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { NotificationItem } from "../types";

export const NotificationsPage: React.FC = () => {
    const { user, loading: authLoading } = useAuth();
    const navigate = useNavigate();

    const [notifications, setNotifications] = useState<NotificationItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchNotifications = useCallback(async () => {
        if (!user) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const { data } = await api.get("/notifications");
            setNotifications(data.notifications || []);
        } catch (err: any) {
            console.error("Error fetching notifications:", err);
            const msg =
                err?.code === "ECONNABORTED"
                    ? "Request timed out while loading notifications. Please try again."
                    : err?.response?.data?.error || "Unable to load notifications. Please try again.";
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        if (!authLoading) {
            if (user) {
                fetchNotifications();
            } else {
                setLoading(false);
            }
        }
    }, [user, authLoading, fetchNotifications]);

    const handleMarkAllRead = async () => {
        try {
            await api.patch("/notifications/read");
            setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        } catch (err) {
            console.error("Mark read error:", err);
        }
    };

    const getIcon = (type: NotificationItem["type"]) => {
        switch (type) {
            case "LIKE":
                return <Heart size={20} className="text-pink-500 fill-pink-500" />;
            case "RETWEET":
                return <Repeat size={20} className="text-emerald-400" />;
            case "FOLLOW":
                return <UserPlus size={20} className="text-accent-blue" />;
            case "FOLLOW_REQUEST":
                return <UserPlus size={20} className="text-amber-400" />;
            case "FOLLOW_REQUEST_ACCEPTED":
                return <CheckCheck size={20} className="text-emerald-400" />;
            case "FOLLOW_REQUEST_REJECTED":
                return <UserPlus size={20} className="text-text-muted" />;
            case "REPLY":
                return <MessageCircle size={20} className="text-accent-blue fill-accent-blue" />;
        }
    };

    const getText = (item: NotificationItem) => {
        switch (item.type) {
            case "LIKE":
                return "liked your post";
            case "RETWEET":
                return "reposted your post";
            case "FOLLOW":
                return "started following you";
            case "FOLLOW_REQUEST":
                return "requested to follow you";
            case "FOLLOW_REQUEST_ACCEPTED":
                return "approved your follow request";
            case "FOLLOW_REQUEST_REJECTED":
                return "declined your follow request";
            case "REPLY":
                return "replied to your post";
        }
    };

    return (
        <main className="center-column w-full md:w-[630px] min-h-screen md:min-h-0 md:h-full md:overflow-y-auto md:overflow-x-hidden relative border-r border-border-dark flex-shrink-0 md:scroll-smooth">
            {/* Header */}
            <div className="sticky top-0 z-20 bg-black/90 backdrop-blur-md border-b border-border-dark px-5 py-3.5 flex items-center justify-between">
                <h2 className="text-xl font-extrabold text-white">Notifications</h2>
                <button
                    onClick={handleMarkAllRead}
                    className="text-text-muted hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
                    title="Mark all as read"
                >
                    <CheckCheck size={20} />
                </button>
            </div>

            {loading ? (
                <div className="flex justify-center py-16">
                    <Loader2 size={32} className="animate-spin text-accent-blue" />
                </div>
            ) : !user ? (
                <div className="py-20 px-5 text-center text-text-secondary">
                    <Bell size={42} className="text-text-muted mx-auto mb-3.5" />
                    <h3 className="text-xl font-bold text-text-primary mb-2">
                        Sign in to view notifications
                    </h3>
                    <p className="max-w-xs mx-auto mb-5 text-sm text-text-muted">
                        Join the conversation to see replies, likes, reposts, and new followers.
                    </p>
                    <button
                        onClick={() => navigate("/auth")}
                        className="bg-accent-blue hover:bg-accent-blue-hover text-white font-bold py-2.5 px-6 rounded-full text-sm shadow-md transition-all cursor-pointer"
                    >
                        Sign In
                    </button>
                </div>
            ) : error ? (
                <div className="py-20 px-5 text-center text-text-secondary">
                    <AlertCircle size={42} className="text-red-500 mx-auto mb-3.5" />
                    <h3 className="text-lg font-bold text-text-primary mb-2">
                        {error}
                    </h3>
                    <button
                        onClick={fetchNotifications}
                        className="mt-3 bg-surface-secondary hover:bg-surface-hover border border-border-dark text-white font-bold text-xs py-2 px-5 rounded-full transition-all cursor-pointer"
                    >
                        Retry
                    </button>
                </div>
            ) : notifications.length === 0 ? (
                <div className="py-20 px-5 text-center text-text-secondary">
                    <h3 className="text-xl font-bold text-text-primary mb-2">
                        Nothing to see here — yet
                    </h3>
                    <p className="max-w-xs mx-auto text-sm text-text-muted">
                        From likes to reposts and a whole lot more, this is where all the action about your posts and account happens.
                    </p>
                </div>
            ) : (
                notifications.map((n) => (
                    <div
                        key={n.id}
                        onClick={async () => {
                            if (!n.read) {
                                try {
                                    await api.patch("/notifications/read", { notificationId: n.id });
                                    setNotifications((prev) =>
                                        prev.map((item) => (item.id === n.id ? { ...item, read: true } : item))
                                    );
                                } catch (err) {
                                    console.error("Mark single read error:", err);
                                }
                            }
                            if (n.tweet?.id) navigate(`/tweet/${n.tweet.id}`);
                            else navigate(`/profile/${n.sourceUser.username}`);
                        }}
                        className={`flex gap-3.5 px-5 py-4 border-b border-border-dark transition-colors cursor-pointer ${
                            n.read
                                ? "bg-transparent hover:bg-white/[0.02]"
                                : "bg-accent-blue/[0.04] hover:bg-white/[0.03]"
                        }`}
                    >
                        <div className="pt-0.5">{getIcon(n.type)}</div>

                        <div className="flex-1 min-w-0">
                            <img
                                src={
                                    n.sourceUser.avatarUrl ||
                                    `https://api.dicebear.com/7.x/identicon/svg?seed=${n.sourceUser.username}`
                                }
                                alt={n.sourceUser.username}
                                className="w-8 h-8 rounded-full object-cover mb-2"
                            />

                            <div>
                                <strong className="text-white font-bold">{n.sourceUser.username}</strong>{" "}
                                <span className="text-text-secondary text-sm">{getText(n)}</span>
                            </div>

                            {n.tweet && (
                                <p className="text-text-muted text-xs sm:text-sm mt-1 truncate">
                                    "{n.tweet.content.slice(0, 80)}..."
                                </p>
                            )}
                        </div>
                    </div>
                ))
            )}
        </main>
    );
};
