import React, { useCallback, useState, useEffect, useRef } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { createPortal } from "react-dom";
import {
    Home,
    Compass,
    Bell,
    Mail,
    Bookmark,
    User as UserIcon,
    Sparkles,
    Feather,
    LogOut,
    CheckCircle,
    MoreHorizontal,
    Sun,
    Moon,
    UserPlus,
    Settings,
    CircleHelp,
    CreditCard,
} from "lucide-react";
import { useAuth } from "../features/auth/hooks";
import { useSocket } from "../features/socket/hooks";
import { useTheme } from "../features/theme/hooks";
import { api } from "../api/client";
import logoImg from "../assets/socialsphere-mark.svg";
import { UserAvatar } from "./UserAvatar";

interface SidebarProps {
    onOpenComposer?: () => void;
    onOpenPremiumModal?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
    onOpenComposer,
    onOpenPremiumModal,
}) => {
    const { user, logout } = useAuth();
    const { unreadDMsCount } = useSocket();
    const { theme, toggleTheme } = useTheme();
    const navigate = useNavigate();
    const location = useLocation();
    const [unreadCount, setUnreadCount] = useState(0);

    const [showAccountMenu, setShowAccountMenu] = useState(false);
    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const [moreMenuPosition, setMoreMenuPosition] = useState({ left: 12, top: 12 });
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const accountMenuRef = useRef<HTMLDivElement | null>(null);
    const moreButtonRef = useRef<HTMLButtonElement | null>(null);
    const moreMenuRef = useRef<HTMLDivElement | null>(null);

    const positionMoreMenu = useCallback(() => {
        const trigger = moreButtonRef.current;
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        const width = Math.min(320, window.innerWidth - 24);
        const height = 190;
        const mobile = window.innerWidth < 768;
        const left = mobile
            ? Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
            : Math.max(12, Math.min(rect.right + 8, window.innerWidth - width - 12));
        const top = mobile
            ? Math.max(12, rect.top - height - 8)
            : Math.max(12, Math.min(rect.top - 55, window.innerHeight - height - 12));
        setMoreMenuPosition({ left, top });
    }, []);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
                setShowAccountMenu(false);
            }
        };
        if (showAccountMenu) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [showAccountMenu]);

    useEffect(() => {
        if (!showMoreMenu) return;
        positionMoreMenu();
        moreMenuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
        const closeIfOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (!moreMenuRef.current?.contains(target) && !moreButtonRef.current?.contains(target)) setShowMoreMenu(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setShowMoreMenu(false);
                moreButtonRef.current?.focus();
            }
        };
        document.addEventListener("mousedown", closeIfOutside);
        document.addEventListener("keydown", handleKeyDown);
        window.addEventListener("resize", positionMoreMenu);
        window.addEventListener("scroll", positionMoreMenu, true);
        return () => {
            document.removeEventListener("mousedown", closeIfOutside);
            document.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("resize", positionMoreMenu);
            window.removeEventListener("scroll", positionMoreMenu, true);
        };
    }, [showMoreMenu, positionMoreMenu]);

    useEffect(() => {
        if (!user) {
            return;
        }

        let isCancelled = false;
        const checkUnread = async () => {
            try {
                const { data } = await api.get("/notifications");
                if (!isCancelled) {
                    const unread = (data.notifications || []).filter((n: { read: boolean }) => !n.read).length;
                    setUnreadCount(unread);
                }
            } catch {
                // Ignore silent poll errors
            }
        };

        checkUnread();
        const interval = setInterval(checkUnread, 30000); // Polling every 30s as fallback
        return () => {
            isCancelled = true;
            clearInterval(interval);
        };
    }, [user, location.pathname]);

    return (
        <aside className="left-sidebar fixed bottom-0 left-0 right-0 z-50 h-[58px] w-full border-t border-border-dark bg-black/95 backdrop-blur-lg flex flex-row items-center justify-around px-2 md:static md:z-auto md:w-[78px] xl:w-[275px] md:h-full md:overflow-y-auto md:overflow-x-hidden md:flex-col md:justify-between md:p-4 md:border-r md:border-t-0 md:bg-transparent md:backdrop-blur-none flex-shrink-0">
            <div className="w-full flex md:flex-col items-center xl:items-start justify-around md:justify-start">
                {/* Brand Logo with Circular Badge */}
                <NavLink
                    to="/"
                    className="hidden md:flex items-center gap-3 p-2.5 rounded-full hover:bg-white/5 transition-all text-white font-extrabold text-xl tracking-tight mb-2 group"
                    aria-label="SocialSphere Home"
                >
                    <div className="w-10 h-10 aspect-square rounded-full overflow-hidden bg-surface-primary border border-accent-blue/30 flex items-center justify-center p-1.5 flex-shrink-0 shadow-md shadow-black/50 group-hover:border-accent-blue group-hover:scale-105 transition-all">
                        <img src={logoImg} alt="SocialSphere" className="h-full w-full object-contain" />
                    </div>
                    <span className="hidden xl:inline text-white font-extrabold text-xl tracking-tight">
                        SocialSphere
                    </span>
                </NavLink>

                {/* Navigation Links */}
                <nav className="flex flex-row justify-around items-center w-full md:flex-col md:items-start md:gap-1.5">
                    <NavLink
                        to="/"
                        className={({ isActive }) =>
                            `flex items-center justify-center xl:justify-start gap-4 p-2.5 md:p-3 xl:px-4 xl:py-3 rounded-full text-base font-semibold transition-all relative ${
                                isActive
                                    ? "text-accent-blue font-bold md:bg-accent-blue md:text-white md:shadow-md md:shadow-accent-blue/25"
                                    : "text-text-muted md:text-text-primary hover:text-white md:hover:bg-white/10"
                            }`
                        }
                    >
                        <Home size={24} />
                        <span className="hidden xl:inline">Home</span>
                    </NavLink>

                    <NavLink
                        to="/explore"
                        className={({ isActive }) =>
                            `flex items-center justify-center xl:justify-start gap-4 p-2.5 md:p-3 xl:px-4 xl:py-3 rounded-full text-base font-semibold transition-all relative ${
                                isActive
                                    ? "text-accent-blue font-bold md:bg-accent-blue md:text-white md:shadow-md md:shadow-accent-blue/25"
                                    : "text-text-muted md:text-text-primary hover:text-white md:hover:bg-white/10"
                            }`
                        }
                    >
                        <Compass size={24} />
                        <span className="hidden xl:inline">Explore</span>
                    </NavLink>

                    <NavLink
                        to="/notifications"
                        className={({ isActive }) =>
                            `flex items-center justify-center xl:justify-start gap-4 p-2.5 md:p-3 xl:px-4 xl:py-3 rounded-full text-base font-semibold transition-all relative ${
                                isActive
                                    ? "text-accent-blue font-bold md:bg-accent-blue md:text-white md:shadow-md md:shadow-accent-blue/25"
                                    : "text-text-muted md:text-text-primary hover:text-white md:hover:bg-white/10"
                            }`
                        }
                    >
                        <div className="relative inline-flex">
                            <Bell size={24} />
                            {unreadCount > 0 && (
                                <span className="absolute -top-1 -right-1.5 bg-accent-blue text-white text-[0.7rem] font-extrabold rounded-full min-w-4 h-4 flex items-center justify-center px-1">
                                    {unreadCount > 9 ? "9+" : unreadCount}
                                </span>
                            )}
                        </div>
                        <span className="hidden xl:inline">Notifications</span>
                    </NavLink>

                    <NavLink
                        to="/messages"
                        className={({ isActive }) =>
                            `flex items-center justify-center xl:justify-start gap-4 p-2.5 md:p-3 xl:px-4 xl:py-3 rounded-full text-base font-semibold transition-all relative ${
                                isActive
                                    ? "text-accent-blue font-bold md:bg-accent-blue md:text-white md:shadow-md md:shadow-accent-blue/25"
                                    : "text-text-muted md:text-text-primary hover:text-white md:hover:bg-white/10"
                            }`
                        }
                    >
                        <div className="relative inline-flex">
                            <Mail size={24} />
                            {unreadDMsCount > 0 && (
                                <span className="absolute -top-1 -right-1.5 bg-accent-blue text-white text-[0.7rem] font-extrabold rounded-full min-w-4 h-4 flex items-center justify-center px-1">
                                    {unreadDMsCount > 9 ? "9+" : unreadDMsCount}
                                </span>
                            )}
                        </div>
                        <span className="hidden xl:inline">Messages</span>
                    </NavLink>

                    <NavLink
                        to="/bookmarks"
                        className={({ isActive }) =>
                            `flex items-center justify-center xl:justify-start gap-4 p-2.5 md:p-3 xl:px-4 xl:py-3 rounded-full text-base font-semibold transition-all relative ${
                                isActive
                                    ? "text-accent-blue font-bold md:bg-accent-blue md:text-white md:shadow-md md:shadow-accent-blue/25"
                                    : "text-text-muted md:text-text-primary hover:text-white md:hover:bg-white/10"
                            }`
                        }
                    >
                        <Bookmark size={24} />
                        <span className="hidden xl:inline">Bookmarks</span>
                    </NavLink>

                    {user && (
                        <NavLink
                            to={`/profile/${user.username}`}
                            className={({ isActive }) =>
                                `flex items-center justify-center xl:justify-start gap-4 p-2.5 md:p-3 xl:px-4 xl:py-3 rounded-full text-base font-semibold transition-all relative ${
                                    isActive
                                        ? "text-accent-blue font-bold md:bg-accent-blue md:text-white md:shadow-md md:shadow-accent-blue/25"
                                        : "text-text-muted md:text-text-primary hover:text-white md:hover:bg-white/10"
                                }`
                            }
                        >
                            <UserIcon size={24} />
                            <span className="hidden xl:inline">Profile</span>
                        </NavLink>
                    )}

                    {/* Premium Upgrade Button */}
                    <button
                        onClick={onOpenPremiumModal}
                        className="hidden md:flex items-center justify-center xl:justify-start gap-4 p-2.5 md:p-3 xl:px-4 xl:py-3 rounded-full text-base font-semibold transition-all text-premium-violet hover:bg-purple-950/20 w-full text-left cursor-pointer hover:scale-[1.02]"
                    >
                        <Sparkles size={24} />
                        <span className="hidden xl:inline">Premium</span>
                    </button>

                    {/* More Options Button (Matching Reference 3) */}
                    <div className="relative w-full md:block">
                    <button
                        ref={moreButtonRef}
                        onClick={() => setShowMoreMenu((open) => !open)}
                        aria-label="Open more options"
                        aria-expanded={showMoreMenu}
                        aria-haspopup="menu"
                        aria-controls="sidebar-more-menu"
                        className="flex w-full cursor-pointer items-center justify-center gap-4 rounded-full p-2.5 text-left text-base font-semibold text-text-primary transition-all hover:bg-white/10 md:p-3 xl:justify-start xl:px-4 xl:py-3"
                    >
                        <MoreHorizontal size={24} />
                        <span className="hidden xl:inline">More</span>
                    </button>
                    {showMoreMenu && createPortal(
                        <div id="sidebar-more-menu" ref={moreMenuRef} role="menu" aria-label="More options" style={{ left: moreMenuPosition.left, top: moreMenuPosition.top }} className="fixed z-[100] w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-border-dark bg-surface-primary py-2 shadow-2xl shadow-black/30">
                            {[
                                { label: "Settings and privacy", description: "Account details, privacy and password", to: "/settings", Icon: Settings, protected: true },
                                { label: "Help Center", description: "Guides and answers to common questions", to: "/help", Icon: CircleHelp, protected: false },
                                { label: "Billing", description: "Plan, payments and subscription", to: "/settings/billing", Icon: CreditCard, protected: true },
                            ].map(({ label, description, to, Icon, protected: needsLogin }) => (
                                <button key={to} role="menuitem" onClick={() => {
                                    setShowMoreMenu(false);
                                    const destination = needsLogin && !user ? `/auth?mode=login&redirect=${encodeURIComponent(to)}` : to;
                                    navigate(destination);
                                }} className="flex w-full items-center gap-3 border-b border-border-dark px-4 py-3 text-left transition hover:bg-white/5 last:border-0">
                                    <Icon size={18} className="shrink-0 text-accent-blue" />
                                    <span><span className="block font-bold text-text-primary">{label}</span><span className="mt-0.5 block text-xs text-text-muted">{description}</span></span>
                                </button>
                            ))}
                        </div>,
                        document.body,
                    )}
                    </div>

                    {/* Theme Mode Toggle Button */}
                    <button
                        onClick={toggleTheme}
                        className="hidden md:flex items-center justify-center xl:justify-start gap-4 p-2.5 md:p-3 xl:px-4 xl:py-3 rounded-full text-base font-semibold transition-all text-text-primary hover:bg-white/10 w-full text-left cursor-pointer"
                        title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
                    >
                        {theme === "dark" ? (
                            <Sun size={24} className="text-amber-400" />
                        ) : (
                            <Moon size={24} className="text-accent-blue" />
                        )}
                        <span className="hidden xl:inline">
                            {theme === "dark" ? "Light Mode" : "Dark Mode"}
                        </span>
                    </button>
                </nav>

                {/* Big Compose Button */}
                <button
                    onClick={
                        onOpenComposer ||
                        (() => {
                            const col = document.querySelector(".center-column");
                            if (col) col.scrollTo({ top: 0, behavior: "smooth" });
                            window.scrollTo({ top: 0, behavior: "smooth" });
                        })
                    }
                    className="hidden md:flex items-center justify-center gap-2 mt-4 bg-gradient-to-r from-accent-blue to-accent-blue-hover text-white rounded-full font-bold shadow-lg shadow-accent-blue/25 hover:brightness-110 hover:-translate-y-0.5 transition-all w-12 h-12 xl:w-full xl:h-auto xl:py-3.5 xl:px-5 cursor-pointer"
                >
                    <Feather size={20} />
                    <span className="hidden xl:inline">Post</span>
                </button>
            </div>

            {/* User profile / Account switcher card (Matching Image 2 & 3) */}
            {user ? (
                <div className="relative w-full mt-4" ref={accountMenuRef}>
                    {/* Popup menu (matching Image 3) */}
                    {showAccountMenu && (
                        <div className="absolute bottom-full mb-3 left-0 right-0 xl:w-[280px] bg-surface-primary border border-border-dark rounded-2xl shadow-2xl shadow-black/80 py-2 z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                            <button
                                onClick={() => {
                                    setShowAccountMenu(false);
                                    navigate("/auth?mode=login");
                                }}
                                className="w-full px-4 py-3 text-left font-bold text-sm text-white hover:bg-white/5 flex items-center gap-2.5 transition-colors cursor-pointer"
                            >
                                <UserPlus size={18} className="text-accent-blue" />
                                <span>Add an existing account</span>
                            </button>

                            <button
                                onClick={() => {
                                    setShowAccountMenu(false);
                                    setShowLogoutConfirm(true);
                                }}
                                className="w-full px-4 py-3 text-left font-bold text-sm text-white hover:bg-white/5 flex items-center gap-2.5 transition-colors cursor-pointer border-t border-border-dark"
                            >
                                <LogOut size={18} className="text-red-400" />
                                <span className="truncate">Log out @{user.username}</span>
                            </button>
                        </div>
                    )}

                    {/* Account Row Pill (matching Image 2) */}
                    <div
                        className="hidden md:flex items-center justify-between p-2 xl:px-3 xl:py-2.5 rounded-full hover:bg-white/5 cursor-pointer border border-transparent hover:border-border-dark transition-all w-full"
                        onClick={() => setShowAccountMenu((prev) => !prev)}
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <UserAvatar src={user.avatarUrl} name={user.name} username={user.username} className="h-10 w-10 flex-shrink-0 rounded-full border border-border-dark bg-surface-secondary object-cover text-lg" />
                            <div className="hidden xl:block min-w-0">
                                <div className="flex items-center gap-1">
                                    <span className="font-bold text-sm text-text-primary truncate">
                                        {user.name || user.username}
                                    </span>
                                    {user.isVerified && (
                                        <CheckCircle
                                            size={14}
                                            className="text-accent-blue fill-accent-blue flex-shrink-0"
                                        />
                                    )}
                                </div>
                                <span className="text-xs text-text-secondary truncate block">
                                    @{user.username}
                                </span>
                            </div>
                        </div>
                        <MoreHorizontal size={18} className="hidden xl:block text-text-secondary hover:text-white flex-shrink-0" />
                    </div>
                </div>
            ) : (
                <div className="mt-4 hidden w-full flex-col gap-2 md:flex">
                    <button
                        onClick={() => navigate("/auth?mode=login")}
                        className="flex w-full items-center justify-center rounded-full bg-surface-secondary p-3 text-sm font-bold text-white transition hover:bg-surface-hover xl:px-5 xl:py-3"
                    >
                        <span className="hidden xl:inline">Log in</span>
                        <span className="xl:hidden">In</span>
                    </button>
                    <button
                        onClick={() => navigate("/auth?mode=register")}
                        className="flex w-full items-center justify-center rounded-full bg-accent-blue p-3 text-sm font-bold text-white transition hover:bg-accent-blue-hover xl:px-5 xl:py-3"
                    >
                        <span className="hidden xl:inline">Sign up</span>
                        <span className="xl:hidden">Join</span>
                    </button>
                </div>
            )}

            {/* Logout Confirmation Modal */}
            {showLogoutConfirm && user && (
                <div
                    className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setShowLogoutConfirm(false)}
                >
                    <div
                        className="bg-surface-primary border border-border-dark rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="w-12 h-12 aspect-square rounded-full overflow-hidden bg-surface-primary border border-accent-blue/30 flex items-center justify-center p-2 mx-auto mb-4 shadow-md">
                            <img src={logoImg} alt="SocialSphere" className="w-full h-full object-contain rounded-full" />
                        </div>
                        <h3 className="text-xl font-extrabold text-white mb-2">
                            Log out of SocialSphere?
                        </h3>
                        <p className="text-xs text-text-secondary leading-relaxed mb-6">
                            You can always log back in at any time. If you just want to switch accounts, you can add another account.
                        </p>

                        <div className="flex flex-col gap-2.5">
                            <button
                                onClick={async () => {
                                    setShowLogoutConfirm(false);
                                    await logout();
                                }}
                                className="w-full bg-white hover:bg-gray-200 text-black font-extrabold text-sm py-3 px-5 rounded-full transition-all cursor-pointer shadow-md"
                            >
                                Log out
                            </button>
                            <button
                                onClick={() => setShowLogoutConfirm(false)}
                                className="w-full border border-border-dark text-white font-bold text-sm py-3 px-5 rounded-full hover:bg-white/5 transition-all cursor-pointer"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </aside>
    );
};
