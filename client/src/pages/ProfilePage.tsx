import React, { useState, useEffect } from "react";
import { isAxiosError } from "axios";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
    Calendar,
    CheckCircle,
    ArrowLeft,
    Loader2,
    ShieldAlert,
    X,
    Lock,
} from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../features/auth/hooks";
import { TweetCard } from "../components/TweetCard";
import { Pagination } from "../components/Pagination";
import type { User, Tweet } from "../types";

interface ProfilePageProps {
    onOpenPremiumModal?: () => void;
}

interface FollowRequestRow {
    id: string;
    requester?: Pick<User, "id" | "username" | "avatarUrl">;
    target?: Pick<User, "id" | "username" | "avatarUrl">;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ onOpenPremiumModal }) => {
    const { username } = useParams<{ username: string }>();
    const { user: currentUser } = useAuth();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const rawPage = parseInt(searchParams.get("page") || "1", 10);
    const currentPage = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

    const [profile, setProfile] = useState<User | null>(null);
    const [tweets, setTweets] = useState<Tweet[]>([]);
    const [totalCount, setTotalCount] = useState<number>(0);
    const [totalPages, setTotalPages] = useState<number>(1);
    const [loading, setLoading] = useState(true);
    const [isFollowLoading, setIsFollowLoading] = useState(false);
    const [showVerificationBanner, setShowVerificationBanner] = useState(true);

    const limit = 10;

    // Edit Profile Modal State
    const [isEditing, setIsEditing] = useState(false);
    const [editBio, setEditBio] = useState("");
    const [editAvatar, setEditAvatar] = useState("");
    const [editError, setEditError] = useState("");

    // Followers & Following List Modal State
    const [followModalTitle, setFollowModalTitle] = useState<"Followers" | "Following" | null>(null);
    const [followList, setFollowList] = useState<User[]>([]);
    const [isFollowListLoading, setIsFollowListLoading] = useState(false);
    const [editIsPrivate, setEditIsPrivate] = useState(false);
    const [receivedRequests, setReceivedRequests] = useState<FollowRequestRow[]>([]);
    const [sentRequests, setSentRequests] = useState<FollowRequestRow[]>([]);

    const isOwnProfile = currentUser?.username === username;

    const openFollowModal = async (type: "followers" | "following") => {
        if (!username) return;
        setFollowModalTitle(type === "followers" ? "Followers" : "Following");
        setIsFollowListLoading(true);
        try {
            const { data } = await api.get(`/users/${username}/${type}`);
            setFollowList(type === "followers" ? data.followers : data.following);
        } catch (err) {
            console.error("Error fetching follow list:", err);
        } finally {
            setIsFollowListLoading(false);
        }
    };

    useEffect(() => {
        const fetchProfileData = async () => {
            if (!username) return;
            setLoading(true);

            try {
                const offset = (currentPage - 1) * limit;
                const profileRes = await api.get(`/users/profile/${username}`);
                const nextProfile = profileRes.data.user as User;
                setProfile(profileRes.data.user);
                setEditBio(profileRes.data.user.bio || "");
                setEditAvatar(profileRes.data.user.avatarUrl || "");
                setEditIsPrivate(!!profileRes.data.user.isPrivate);
                const canView = nextProfile.canViewContent ?? (!nextProfile.isPrivate || nextProfile.isFollowing || isOwnProfile);
                if (!canView || nextProfile.isBlocked || nextProfile.isBlockedBy) {
                    setTweets([]);
                    setTotalCount(0);
                    setTotalPages(1);
                    return;
                }

                const tweetsRes = await api.get(`/tweets/user/${username}?page=${currentPage}&limit=${limit}&offset=${offset}`);
                setTweets(tweetsRes.data.tweets || []);

                const receivedTotal = tweetsRes.data.pagination?.totalCount ?? tweetsRes.data.tweets?.length ?? 0;
                setTotalCount(receivedTotal);
                setTotalPages(Math.max(1, Math.ceil(receivedTotal / limit)));
            } catch (err) {
                console.error("Error loading profile:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchProfileData();
    }, [username, currentPage, isOwnProfile]);

    useEffect(() => {
        if (!isOwnProfile) {
            return;
        }
        let canceled = false;
        Promise.all([api.get("/users/follow-requests/received"), api.get("/users/follow-requests/sent")])
            .then(([received, sent]) => {
                if (!canceled) {
                    setReceivedRequests(received.data.requests || []);
                    setSentRequests(sent.data.requests || []);
                }
            })
            .catch((err) => console.error("Unable to load follow requests:", err));
        return () => { canceled = true; };
    }, [isOwnProfile, profile?.isPrivate]);

    const handlePageChange = (newPage: number) => {
        if (newPage === currentPage || newPage < 1 || newPage > totalPages) return;
        setSearchParams({ page: String(newPage) });
        const centerCol = document.querySelector(".center-column");
        if (centerCol) {
            centerCol.scrollTo({ top: 0, behavior: "smooth" });
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const handleFollowToggle = async () => {
        if (!currentUser) {
            navigate("/auth");
            return;
        }

        if (!profile || isFollowLoading) return;
        setIsFollowLoading(true);

        try {
            if (profile.isFollowRequested && profile.followRequestId) {
                await api.post(`/users/follow-requests/${profile.followRequestId}/cancel`);
                setProfile((prev) => prev ? { ...prev, isFollowRequested: false, followRequestId: null } : null);
            } else if (profile.isFollowing) {
                await api.post(`/users/unfollow/${profile.id}`);
                setProfile((prev) => prev ? {
                    ...prev,
                    isFollowing: false,
                    _count: prev._count ? { ...prev._count, followers: Math.max(0, prev._count.followers - 1) } : prev._count,
                } : null);
            } else {
                const { data } = await api.post(`/users/follow/${profile.id}`);
                setProfile((prev) => prev ? {
                    ...prev,
                    isFollowing: !!data.isFollowing,
                    isFollowRequested: !!data.isRequested,
                    followRequestId: data.followRequestId || null,
                    _count: prev._count && data.isFollowing
                        ? { ...prev._count, followers: prev._count.followers + 1 }
                        : prev._count,
                } : null);
            }
        } catch {
            // Keep the server-confirmed profile state when the request fails.
        } finally {
            setIsFollowLoading(false);
        }
    };

    const handleBlockToggle = async () => {
        if (!profile) return;
        if (!window.confirm(`Are you sure you want to ${profile.isBlocked ? "unblock" : "block"} @${profile.username}?`)) return;

        try {
            if (profile.isBlocked) {
                await api.post(`/users/unblock/${profile.id}`);
                setProfile((prev) => prev ? { ...prev, isBlocked: false } : null);
            } else {
                await api.post(`/users/block/${profile.id}`);
                setProfile((prev) => prev ? { ...prev, isBlocked: true, isFollowing: false } : null);
            }
        } catch (err) {
            console.error("Block action failed:", err);
        }
    };

    const handleSaveProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        setEditError("");
        try {
            const { data } = await api.patch("/users/profile", {
                bio: editBio,
                avatarUrl: editAvatar.trim() || null,
                isPrivate: editIsPrivate,
            });

            setProfile((prev) => (prev ? { ...prev, ...data.user } : null));
            setIsEditing(false);
        } catch (err: unknown) {
            console.error("Save profile error:", err);
            setEditError(isAxiosError(err) && typeof err.response?.data?.error === "string" ? err.response.data.error : "Failed to update profile");
        }
    };

    const handleFollowRequestDecision = async (requestId: string, decision: "accept" | "reject") => {
        try {
            await api.post(`/users/follow-requests/${requestId}/${decision}`);
            const [{ data: received }, { data: sent }] = await Promise.all([
                api.get("/users/follow-requests/received"),
                api.get("/users/follow-requests/sent"),
            ]);
            setReceivedRequests(received.requests || []);
            setSentRequests(sent.requests || []);
            if (decision === "accept") {
                setProfile((prev) => prev ? {
                    ...prev,
                    _count: prev._count ? { ...prev._count, followers: prev._count.followers + 1 } : prev._count,
                } : null);
            }
        } catch (err: unknown) {
            setEditError(isAxiosError(err) && typeof err.response?.data?.error === "string" ? err.response.data.error : "Unable to update follow request.");
        }
    };

    const handleCancelSentRequest = async (requestId: string) => {
        try {
            await api.post(`/users/follow-requests/${requestId}/cancel`);
            setSentRequests((previous) => previous.filter((request) => request.id !== requestId));
        } catch (err: unknown) {
            setEditError(isAxiosError(err) && typeof err.response?.data?.error === "string" ? err.response.data.error : "Unable to cancel follow request.");
        }
    };

    if (loading) {
        return (
            <main className="center-column w-full md:w-[630px] min-h-screen md:min-h-0 md:h-full md:overflow-y-auto md:overflow-x-hidden relative border-r border-border-dark flex-shrink-0 md:scroll-smooth flex justify-center py-16">
                <Loader2 size={32} className="animate-spin text-accent-blue" />
            </main>
        );
    }

    if (!profile) {
        return (
            <main className="center-column w-full md:w-[630px] min-h-screen md:min-h-0 md:h-full md:overflow-y-auto md:overflow-x-hidden relative border-r border-border-dark flex-shrink-0 md:scroll-smooth py-16 px-5 text-center">
                <h2 className="text-xl font-bold text-white">This account does not exist</h2>
                <p className="text-text-secondary text-sm mt-2">Try searching for another user.</p>
            </main>
        );
    }

    return (
        <main className="center-column w-full md:w-[630px] min-h-screen md:min-h-0 md:h-full md:overflow-y-auto md:overflow-x-hidden relative border-r border-border-dark flex-shrink-0 md:scroll-smooth">
            {/* Header with back button */}
            <div className="sticky top-0 z-20 bg-black/90 backdrop-blur-md border-b border-border-dark px-4 py-2.5 flex items-center gap-6">
                <button
                    onClick={() => navigate(-1)}
                    className="text-text-muted hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h2 className="text-xl font-extrabold text-white">{profile.name || profile.username}</h2>
                    <span className="text-xs text-text-muted">
                        {profile._count?.tweets || 0} posts
                        {profile.isPrivate && <span className="ml-2 inline-flex items-center gap-1 text-text-secondary"><Lock size={12} /> Private</span>}
                    </span>
                </div>
            </div>

            {/* Profile Banner */}
            <div className="h-44 sm:h-52 bg-gradient-to-r from-surface-secondary via-[#1a253a] to-[#121926] relative border-b border-border-dark" />

            {/* Avatar & Action Button Row */}
            <div className="px-4 flex justify-between items-end -mt-14 sm:-mt-16 mb-3 relative z-10">
                <img
                    src={
                        profile.avatarUrl ||
                        `https://api.dicebear.com/7.x/identicon/svg?seed=${profile.username}`
                    }
                    alt={profile.username}
                    className="w-28 h-28 sm:w-32 sm:h-32 rounded-full border-4 border-black bg-surface-secondary object-cover shadow-2xl flex-shrink-0"
                />

                <div className="flex items-center gap-2 mb-1">
                    {isOwnProfile ? (
                        <button
                            onClick={() => setIsEditing(true)}
                            className="border border-border-dark hover:border-text-muted text-white font-bold text-xs sm:text-sm px-4 sm:px-5 py-1.5 rounded-full hover:bg-white/5 transition-all cursor-pointer shadow-sm"
                        >
                            Edit profile
                        </button>
                    ) : (
                        <>
                            <button
                                onClick={handleBlockToggle}
                                className={`p-2 rounded-full border transition-colors cursor-pointer ${
                                    profile.isBlocked
                                        ? "text-red-400 border-red-500/50 hover:bg-red-500/10"
                                        : "text-text-muted border-border-dark hover:bg-white/5 hover:text-white"
                                }`}
                                title={profile.isBlocked ? "Unblock user" : "Block user"}
                            >
                                <ShieldAlert size={18} />
                            </button>

                            {!profile.isBlocked && !profile.isBlockedBy && (
                                <button
                                    onClick={handleFollowToggle}
                                    disabled={isFollowLoading}
                                    className={`font-bold text-xs sm:text-sm px-5 py-1.5 rounded-full transition-all cursor-pointer flex-shrink-0 shadow-sm ${
                                        profile.isFollowing
                                            ? "border border-border-dark text-white hover:bg-red-500/10 hover:border-red-500/60 hover:text-red-500"
                                            : profile.isFollowRequested
                                            ? "border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10"
                                            : "bg-white hover:bg-gray-200 text-black"
                                    }`}
                                >
                                    {profile.isFollowing ? "Following" : profile.isFollowRequested ? "Requested" : profile.isPrivate ? "Request Follow" : "Follow"}
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Profile Info */}
            <div className="px-4 space-y-3">
                <div>
                    <div className="flex items-center gap-1.5">
                        <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                            {profile.name || profile.username}
                        </h1>
                        {profile.isVerified && (
                            <CheckCircle size={18} className="text-accent-blue fill-accent-blue flex-shrink-0" />
                        )}
                    </div>
                    <div className="text-sm text-text-muted">
                        @{profile.username}
                        {profile.isPrivate && <span className="ml-2 inline-flex items-center gap-1 text-xs text-text-secondary"><Lock size={12} /> Private account</span>}
                    </div>
                </div>

                {profile.bio && (
                    <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap break-words">
                        {profile.bio}
                    </p>
                )}

                <div className="flex items-center gap-1.5 text-xs sm:text-sm text-text-muted">
                    <Calendar size={15} />
                    <span>Joined {new Date(profile.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
                </div>

                <div className="flex items-center gap-5 text-sm pt-1 pb-3">
                    <button
                        onClick={() => !profile.isBlocked && !profile.isBlockedBy && openFollowModal("following")}
                        disabled={profile.isBlocked || profile.isBlockedBy}
                        className="flex items-center gap-1 text-text-muted hover:underline cursor-pointer disabled:cursor-default"
                    >
                        <span className="font-extrabold text-white">{profile._count?.following || 0}</span>
                        <span>Following</span>
                    </button>
                    <button
                        onClick={() => !profile.isBlocked && !profile.isBlockedBy && openFollowModal("followers")}
                        disabled={profile.isBlocked || profile.isBlockedBy}
                        className="flex items-center gap-1 text-text-muted hover:underline cursor-pointer disabled:cursor-default"
                    >
                        <span className="font-extrabold text-white">{profile._count?.followers || 0}</span>
                        <span>Followers</span>
                    </button>
                </div>

                {/* Verification Promo Banner (Matching Image 4) */}
                {isOwnProfile && !profile.isVerified && showVerificationBanner && (
                    <div className="verification-promo bg-[#002f1d] border border-emerald-500/35 rounded-2xl p-4 sm:p-5 relative mb-4 shadow-lg shadow-black/40">
                        <button
                            onClick={() => setShowVerificationBanner(false)}
                            className="absolute top-3.5 right-3.5 text-white/70 hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
                            title="Dismiss"
                        >
                            <X size={18} />
                        </button>
                        <div className="flex items-center gap-2 mb-1.5">
                            <h3 className="text-base sm:text-lg font-extrabold text-white">
                                You aren't verified yet
                            </h3>
                            <CheckCircle size={18} className="text-white fill-white flex-shrink-0" />
                        </div>
                        <p className="text-xs sm:text-sm text-emerald-100/90 leading-relaxed max-w-lg mb-4">
                            Get verified for boosted replies, analytics, ad-free browsing, and more. Upgrade your profile now.
                        </p>
                        <button
                            onClick={onOpenPremiumModal}
                            className="bg-white hover:bg-gray-200 text-black font-extrabold text-xs sm:text-sm py-2 px-5 rounded-full transition-all cursor-pointer shadow-md"
                        >
                            Get verified
                        </button>
                    </div>
                )}
            </div>

            {isOwnProfile && (profile.isPrivate || receivedRequests.length > 0 || sentRequests.length > 0) && (
                <section className="mx-4 my-3 rounded-2xl border border-border-dark bg-surface-card p-4">
                    <h3 className="mb-3 text-sm font-extrabold text-white">Follow requests</h3>
                    {receivedRequests.length === 0 && sentRequests.length === 0 ? (
                        <p className="text-xs text-text-muted">No pending requests.</p>
                    ) : (
                        <div className="space-y-3">
                            {receivedRequests.map((request) => (
                                <div key={request.id} className="flex items-center justify-between gap-3">
                                    <button onClick={() => navigate(`/profile/${request.requester?.username}`)} className="truncate text-sm text-white hover:underline">
                                        @{request.requester?.username}
                                    </button>
                                    <div className="flex shrink-0 gap-2">
                                        <button onClick={() => handleFollowRequestDecision(request.id, "accept")} className="rounded-full bg-accent-blue px-3 py-1.5 text-xs font-bold text-white">Accept</button>
                                        <button onClick={() => handleFollowRequestDecision(request.id, "reject")} className="rounded-full border border-border-dark px-3 py-1.5 text-xs font-bold text-text-secondary hover:text-white">Reject</button>
                                    </div>
                                </div>
                            ))}
                            {sentRequests.map((request) => (
                                <div key={request.id} className="flex items-center justify-between gap-3 text-sm">
                                    <span className="truncate text-text-secondary">Requested @{request.target?.username}</span>
                                    <button onClick={() => handleCancelSentRequest(request.id)} className="shrink-0 rounded-full border border-border-dark px-3 py-1.5 text-xs font-bold text-text-secondary hover:text-white">Cancel</button>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {/* Block Banner or Posts */}
            {profile.isBlockedBy ? (
                <div className="py-16 px-5 text-center border-t border-border-dark mt-2">
                    <h3 className="text-xl font-extrabold text-white mb-2">You are blocked</h3>
                    <p className="text-sm text-text-secondary max-w-sm mx-auto">
                        You are blocked from following @{profile.username} and viewing @{profile.username}'s posts.
                    </p>
                </div>
            ) : profile.isBlocked ? (
                <div className="py-16 px-5 text-center border-t border-border-dark mt-2">
                    <h3 className="text-xl font-extrabold text-white mb-2">You blocked @{profile.username}</h3>
                    <p className="text-sm text-text-secondary max-w-sm mx-auto mb-4">
                        You won't see posts or notifications from @{profile.username}.
                    </p>
                    <button
                        onClick={handleBlockToggle}
                        className="border border-red-500 text-red-400 hover:bg-red-500/10 font-bold text-xs py-2 px-5 rounded-full transition-all cursor-pointer"
                    >
                        Unblock @{profile.username}
                    </button>
                </div>
            ) : profile.isPrivate && !(profile.canViewContent ?? (profile.isFollowing || isOwnProfile)) ? (
                <div className="mt-2 border-t border-border-dark px-5 py-16 text-center">
                    <Lock size={34} className="mx-auto mb-3 text-text-muted" />
                    <h3 className="mb-2 text-xl font-extrabold text-white">This account is private</h3>
                    <p className="mx-auto max-w-sm text-sm text-text-secondary">Follow @{profile.username} to see their posts and replies after they approve your request.</p>
                </div>
            ) : (
                <>
                    {/* Feed Tabs */}
                    <div className="border-b border-border-dark flex">
                        <div className="flex-1 py-3 text-center font-bold text-sm text-white relative after:content-[''] after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2 after:w-14 after:h-1 after:bg-accent-blue after:rounded-full">
                            Posts
                        </div>
                    </div>

                    {/* User Tweets */}
                    {tweets.length === 0 ? (
                        <div className="py-16 px-5 text-center text-text-secondary text-sm">
                            No posts from @{profile.username} yet.
                        </div>
                    ) : (
                        <div>
                            {tweets.map((t) => (
                                <TweetCard
                                    key={t.id}
                                    tweet={t}
                                    onDelete={(deletedId) =>
                                        setTweets((prev) => prev.filter((item) => item.id !== deletedId))
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
                </>
            )}

            {/* Edit Profile Modal */}
            {isEditing && (
                <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setIsEditing(false)}>
                    <div className="bg-surface-primary border border-border-dark rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-dark">
                            <span className="font-extrabold text-white text-base">Edit profile</span>
                            <button onClick={() => setIsEditing(false)} className="text-text-muted hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors cursor-pointer">
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleSaveProfile} className="p-5 space-y-4">
                            {editError && (
                                <div className="text-red-400 text-xs p-3 rounded-lg bg-red-950/40 border border-red-500/30">
                                    {editError}
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-semibold text-text-muted mb-1.5">
                                    Avatar Image URL
                                </label>
                                <input
                                    type="text"
                                    value={editAvatar}
                                    onChange={(e) => setEditAvatar(e.target.value)}
                                    placeholder="https://..."
                                    className="w-full bg-surface-secondary border border-border-dark rounded-xl py-2.5 px-3.5 text-sm text-white placeholder:text-text-muted focus:border-accent-blue focus:outline-none focus:ring-1 focus:ring-accent-blue transition-all"
                                />
                            </div>

                            <div>
                                <label className="flex items-center justify-between gap-4 rounded-xl border border-border-dark bg-surface-secondary p-3.5">
                                    <span>
                                        <span className="block text-sm font-semibold text-white">Private account</span>
                                        <span className="block text-xs text-text-muted">New followers need your approval to see your posts.</span>
                                    </span>
                                    <input
                                        type="checkbox"
                                        checked={editIsPrivate}
                                        onChange={(event) => setEditIsPrivate(event.target.checked)}
                                        className="h-4 w-4 accent-accent-blue"
                                    />
                                </label>
                            </div>

                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <label className="text-xs font-semibold text-text-muted">
                                        Bio
                                    </label>
                                    <span className={`text-xs ${editBio.length > 160 ? "text-red-400 font-bold" : "text-text-muted"}`}>
                                        {160 - editBio.length}
                                    </span>
                                </div>
                                <textarea
                                    value={editBio}
                                    onChange={(e) => setEditBio(e.target.value)}
                                    maxLength={160}
                                    rows={3}
                                    placeholder="Tell the world about yourself"
                                    className="w-full bg-surface-secondary border border-border-dark rounded-xl py-2.5 px-3.5 text-sm text-white placeholder:text-text-muted focus:border-accent-blue focus:outline-none focus:ring-1 focus:ring-accent-blue transition-all resize-none"
                                />
                            </div>

                            <div className="flex justify-end gap-2.5 pt-2">
                                <button type="button" onClick={() => setIsEditing(false)} className="border border-border-dark text-white font-bold text-xs py-2 px-4 rounded-full hover:bg-white/10 transition-all cursor-pointer">
                                    Cancel
                                </button>
                                <button type="submit" className="bg-accent-blue hover:bg-accent-blue-hover text-white font-bold text-xs py-2 px-5 rounded-full shadow-md transition-all cursor-pointer">
                                    Save
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Followers / Following Modal */}
            {followModalTitle && (
                <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setFollowModalTitle(null)}>
                    <div className="bg-surface-primary border border-border-dark rounded-2xl w-full max-w-md overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-dark">
                            <span className="font-extrabold text-white text-base">{followModalTitle}</span>
                            <button onClick={() => setFollowModalTitle(null)} className="text-text-muted hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors cursor-pointer">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="max-h-[380px] overflow-y-auto divide-y divide-border-dark">
                            {isFollowListLoading ? (
                                <div className="flex justify-center py-10">
                                    <Loader2 size={24} className="animate-spin text-accent-blue" />
                                </div>
                            ) : followList.length === 0 ? (
                                <div className="py-10 text-center text-text-muted text-xs">
                                    No {followModalTitle.toLowerCase()} yet.
                                </div>
                            ) : (
                                followList.map((u) => (
                                    <div
                                        key={u.id}
                                        onClick={() => {
                                            setFollowModalTitle(null);
                                            navigate(`/profile/${u.username}`);
                                        }}
                                        className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] cursor-pointer transition-colors"
                                    >
                                        <img
                                            src={
                                                u.avatarUrl ||
                                                `https://api.dicebear.com/7.x/identicon/svg?seed=${u.username}`
                                            }
                                            alt={u.username}
                                            className="w-10 h-10 rounded-full object-cover bg-surface-secondary border border-border-dark flex-shrink-0"
                                        />
                                        <div className="min-w-0">
                                            <div className="font-bold text-sm text-white truncate">
                                                {u.username}
                                            </div>
                                            {u.bio && (
                                                <div className="text-xs text-text-muted truncate">
                                                    {u.bio}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
};
