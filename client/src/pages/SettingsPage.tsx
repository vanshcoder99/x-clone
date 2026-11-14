import { useEffect, useMemo, useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import {
    ArrowLeft, ArrowRight, Bell, BookOpen, Check, ChevronRight, CircleHelp, Cookie,
    CreditCard, FileText, Info, Loader2, LockKeyhole, Search, Shield, ShieldCheck,
    Sparkles, UserRound,
} from "lucide-react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../features/auth/hooks";
import brandMark from "../assets/socialsphere-mark.svg";

const sections = [
    { id: "your-account", label: "Your Account", description: "Account information and sign-in security", icon: UserRound },
    { id: "premium", label: "Premium", description: "Your plan and subscription benefits", icon: Sparkles },
    { id: "privacy", label: "Privacy and Safety", description: "Choose who can see your posts", icon: ShieldCheck },
    { id: "notifications", label: "Notifications", description: "Review activity and account alerts", icon: Bell },
    { id: "resources", label: "Additional resources", description: "About, Help, Cookies, Privacy and Terms", icon: BookOpen },
    { id: "help", label: "Help Center", description: "Guides and answers to common questions", icon: CircleHelp },
] as const;

const resources = [
    {
        id: "about",
        label: "About",
        description: "What SocialSphere is and what you can do here.",
        icon: Info,
        group: "SocialSphere",
        paragraphs: [
            "SocialSphere is a place to share ideas, follow conversations and connect with people. Create posts, join discussions, follow accounts and message other members from one community space.",
            "Your home feed brings together posts from accounts you follow and recommendations. Explore helps you discover conversations, while replies, likes and reposts let you take part in them.",
            "Your profile represents you on SocialSphere. Add a display name, username and bio, then choose whether your account is public or private from Privacy and Safety settings.",
            "SocialSphere also includes direct messages, notifications and optional Premium plans. You can review your plan and billing details from the Premium section in Settings.",
            "We want SocialSphere to be useful, welcoming and easy to navigate. Use the Help Center if you need guidance with an account feature.",
        ],
    },
    {
        id: "help",
        label: "Help",
        description: "Find guidance for using SocialSphere.",
        icon: BookOpen,
        group: "SocialSphere",
        paragraphs: [
            "Find answers about your account, posts, following, privacy, messages and Premium features in the SocialSphere Help Center. The articles there cover common questions and walk through the available controls.",
            "For profile changes, open Settings and choose Your Account. You can update your display name, username and bio from Account information.",
            "To control who can see your posts, open Privacy and Safety and choose a public or private account. Private accounts approve new follow requests before those people can see posts.",
            "For messages, notifications or subscriptions, visit the matching section in SocialSphere. The Help Center is available from Settings or the link below.",
        ],
    },
    {
        id: "cookies",
        label: "Cookies",
        description: "How SocialSphere uses browser storage.",
        icon: Cookie,
        group: "Legal",
        paragraphs: [
            "SocialSphere uses an HTTP-only refresh-token cookie to support secure sign-in sessions. It is set and managed by the server, and page scripts cannot read its value.",
            "The sign-in cookie helps the service renew an authenticated session. If you sign out, SocialSphere clears the refresh-token cookie associated with that session.",
            "Your light or dark theme choice is saved in your browser’s local storage so it can be remembered when you return. That preference is stored in your browser and is not a cookie.",
            "This page describes the browser storage used by the current SocialSphere app. Your browser settings can also show and manage cookies and local site data.",
        ],
    },
    {
        id: "terms",
        label: "Terms",
        description: "Guidelines for using SocialSphere.",
        icon: FileText,
        group: "Legal",
        paragraphs: [
            "These Terms describe the basic expectations for using SocialSphere. By using the service, you agree to use its features lawfully and follow these community and account guidelines.",
            "Treat other people respectfully. Do not use SocialSphere to harass, threaten or impersonate people, share unlawful material, or interfere with another person’s use of the service.",
            "Keep your sign-in details secure and use your account responsibly. You are responsible for activity carried out through your account and for content you choose to post or send.",
            "Do not attempt to access accounts or systems without permission, disrupt the platform, or misuse features such as messaging, follows or subscriptions.",
            "SocialSphere may update these Terms as the service and its features change. Check this page for the current guidance, and visit the Help Center if you have a question about using the platform.",
        ],
    },
    {
        id: "privacy",
        label: "Privacy",
        description: "Understand your audience and account privacy controls.",
        icon: Shield,
        group: "Legal",
        paragraphs: [
            "Your profile and posts are public unless you switch your account to private in Privacy and Safety. Public accounts can be followed without approval, and public posts may be viewed by people outside your followers.",
            "With a private account, only approved followers can see your posts. New follow requests need your approval, and you can manage your audience by reviewing follower requests.",
            "SocialSphere uses the information you provide, such as your profile details and posts, to show your profile and provide the features you use. When you follow, react, reply or repost, that activity is connected to the relevant conversation and accounts.",
            "Direct messages are intended for the people in that conversation. Only share information in a message that you are comfortable sending to its participants.",
            "The app uses an HTTP-only refresh-token cookie to support sign-in sessions and stores your theme choice in local storage. See Cookies for more details about this browser storage.",
            "You can change your profile information and public or private account setting in Settings. If you need help understanding a privacy control, open the SocialSphere Help Center.",
        ],
    },
] as const;

type SectionId = typeof sections[number]["id"];
type ResourceId = typeof resources[number]["id"];
type AccountPage = "account-information" | "change-password";

const getErrorMessage = (error: unknown, fallback: string) =>
    isAxiosError(error) && typeof error.response?.data?.error === "string" ? error.response.data.error : fallback;

export const SettingsPage = () => {
    const { user, refreshUser, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [search, setSearch] = useState("");
    const [name, setName] = useState(user?.name || "");
    const [username, setUsername] = useState(user?.username || "");
    const [bio, setBio] = useState(user?.bio || "");
    const [isPrivate, setIsPrivate] = useState(Boolean(user?.isPrivate));
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const sectionParam = searchParams.get("section");
    const accountPageParam = searchParams.get("page");
    const accountPage: AccountPage | null = accountPageParam === "account-information" || accountPageParam === "change-password"
        ? accountPageParam
        : null;
    const resourceParam = searchParams.get("resource");
    const currentResource = resources.find((resource) => resource.id === resourceParam);
    const validSection = sections.some((section) => section.id === sectionParam);
    const selectedSection: SectionId = currentResource ? "resources" : validSection ? sectionParam as SectionId : "your-account";
    const mobileCategoryList = !sectionParam && !accountPageParam && !resourceParam;

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setName(user?.name || "");
            setUsername(user?.username || "");
            setBio(user?.bio || "");
            setIsPrivate(Boolean(user?.isPrivate));
        }, 0);
        return () => window.clearTimeout(timer);
    }, [user]);

    const visibleSections = useMemo(() => sections.filter((section) =>
        `${section.label} ${section.description}`.toLowerCase().includes(search.trim().toLowerCase()),
    ), [search]);

    const visibleResources = useMemo(() => resources.filter((resource) =>
        `${resource.label} ${resource.description}`.toLowerCase().includes(search.trim().toLowerCase()),
    ), [search]);

    const chooseSection = (section: SectionId) => {
        setError("");
        setNotice("");
        setSearchParams({ section }, { replace: false });
    };

    const chooseAccountPage = (page: AccountPage) => {
        setError("");
        setNotice("");
        setSearchParams({ section: "your-account", page }, { replace: false });
    };

    const chooseResource = (resource: ResourceId) => {
        setError("");
        setNotice("");
        setSearchParams({ resource }, { replace: false });
    };

    const backWithinSettings = () => {
        setError("");
        setNotice("");
        if (accountPage) {
            setSearchParams({ section: "your-account" }, { replace: false });
        } else if (currentResource) {
            setSearchParams({ section: "resources" }, { replace: false });
        } else {
            setSearchParams({}, { replace: false });
        }
    };

    const saveAccountInformation = async (event: FormEvent) => {
        event.preventDefault();
        setError("");
        setNotice("");
        setSaving(true);
        try {
            await api.patch("/users/profile", { name, username, bio });
            await refreshUser();
            setNotice("Your account information has been saved.");
        } catch (saveError) {
            setError(getErrorMessage(saveError, "Could not save your account information."));
        } finally {
            setSaving(false);
        }
    };

    const savePrivacy = async (event: FormEvent) => {
        event.preventDefault();
        setError("");
        setNotice("");
        setSaving(true);
        try {
            await api.patch("/users/profile", { isPrivate });
            await refreshUser();
            setNotice(`Your account is now ${isPrivate ? "private" : "public"}.`);
        } catch (saveError) {
            setError(getErrorMessage(saveError, "Could not update your privacy setting."));
        } finally {
            setSaving(false);
        }
    };

    const savePassword = async (event: FormEvent) => {
        event.preventDefault();
        setError("");
        setNotice("");
        if (newPassword !== confirmPassword) {
            setError("The new passwords do not match.");
            return;
        }
        setSaving(true);
        try {
            await api.post("/auth/password", { currentPassword, newPassword });
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setNotice("Your password has been changed.");
        } catch (saveError) {
            setError(getErrorMessage(saveError, "Could not change your password."));
        } finally {
            setSaving(false);
        }
    };

    const inputClass = "mt-2 w-full rounded-xl border border-border-dark bg-surface-secondary px-4 py-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent-blue";

    if (authLoading) return <main className="flex min-h-0 min-w-0 flex-1 items-center justify-center border-x border-border-dark bg-surface-primary p-8"><Loader2 className="animate-spin text-accent-blue" /></main>;
    if (!user) return <main className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center border-x border-border-dark bg-surface-primary px-6 text-center"><Shield size={34} className="mb-4 text-accent-blue" /><h1 className="text-2xl font-extrabold text-text-primary">Sign in to manage settings</h1><p className="mt-2 max-w-sm text-sm leading-6 text-text-secondary">Your account settings are available after you sign in.</p><button type="button" onClick={() => navigate("/auth?mode=login&redirect=%2Fsettings")} className="mt-5 inline-flex items-center gap-2 rounded-full bg-accent-blue px-5 py-2.5 text-sm font-bold text-white hover:bg-accent-blue-hover">Sign in <ArrowRight size={16} /></button></main>;

    const currentSection = sections.find((section) => section.id === selectedSection)!;
    const CurrentIcon = currentResource?.icon ?? currentSection.icon;

    return (
        <main className="settings-page flex h-full min-h-0 min-w-0 flex-1 overflow-hidden border-x border-border-dark bg-surface-primary text-text-primary">
            <aside className={`${mobileCategoryList ? "flex" : "hidden md:flex"} h-full min-h-0 w-full shrink-0 flex-col border-r border-border-dark bg-surface-primary md:w-[300px] lg:w-[340px]`}>
                <header className="border-b border-border-dark px-5 pb-4 pt-5">
                    <h1 className="text-2xl font-extrabold text-text-primary">Settings</h1>
                    <label className="relative mt-4 block">
                        <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Settings" className="w-full rounded-full border border-border-dark bg-black px-4 py-2.5 pl-10 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent-blue" />
                    </label>
                </header>
                <nav aria-label="Settings sections" className="min-h-0 flex-1 overflow-y-auto py-2">
                    {visibleSections.map((section) => {
                        const Icon = section.icon;
                        const selected = selectedSection === section.id;
                        return <div key={section.id}>
                            <button type="button" onClick={() => chooseSection(section.id)} aria-current={selected ? "page" : undefined} className={`flex w-full items-center justify-between gap-3 border-r-2 px-5 py-3.5 text-left transition ${selected ? "border-accent-blue bg-surface-secondary text-text-primary" : "border-transparent text-text-primary hover:bg-surface-secondary"}`}>
                                <span className="flex min-w-0 items-center gap-3"><Icon size={19} className="shrink-0 text-text-muted" /><span className="min-w-0"><span className="block font-semibold">{section.label}</span><span className="mt-0.5 hidden truncate text-xs text-text-muted lg:block">{section.description}</span></span></span>
                                <ChevronRight size={18} className="shrink-0 text-text-muted" />
                            </button>
                        </div>;
                    })}
                    {visibleSections.length === 0 && <p className="px-5 py-8 text-center text-sm text-text-muted">No settings match “{search}”.</p>}
                </nav>
            </aside>

            <section className={`${mobileCategoryList ? "hidden md:flex" : "flex"} min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-surface-primary`}>
                <header className="border-b border-border-dark px-5 py-5 sm:px-7">
                    <button type="button" onClick={backWithinSettings} className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-text-secondary hover:text-text-primary md:hidden"><ArrowLeft size={17} />{currentResource ? "Additional resources" : accountPage ? "Your Account" : "Settings"}</button>
                    <div className="flex items-center gap-2 text-sm font-semibold text-accent-blue"><CurrentIcon size={18} /> {selectedSection === "resources" ? "Additional resources" : "Settings"}</div>
                    <h2 className="mt-2 text-2xl font-extrabold text-text-primary sm:text-3xl">{currentResource?.label ?? (accountPage === "account-information" ? "Account information" : accountPage === "change-password" ? "Change your password" : currentSection.label)}</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">{currentResource?.description ?? (selectedSection === "resources" ? "Explore information about SocialSphere, our policies and the features available to our community." : accountPage === "account-information" ? "Review and update the profile details associated with your account." : accountPage === "change-password" ? "Change the password you use to sign in to SocialSphere." : currentSection.description)}</p>
                </header>

                <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-7 sm:py-7">
                    {error && <p role="alert" className="settings-error mb-4 rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</p>}
                    {notice && <p role="status" className="settings-notice mb-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-300">{notice}</p>}

                    {currentResource && <article className="overflow-hidden rounded-2xl border border-border-dark bg-surface-primary">
                        <div className="space-y-5 px-5 py-6 sm:px-7 sm:py-7">
                            {currentResource.paragraphs.map((paragraph) => <p key={paragraph} className="max-w-3xl text-sm leading-7 text-text-secondary sm:text-base">{paragraph}</p>)}
                            {currentResource.id === "help" && <Link to="/help" className="inline-flex items-center gap-2 rounded-full bg-accent-blue px-5 py-2.5 text-sm font-bold text-white transition hover:bg-accent-blue-hover">Open Help Center <ArrowRight size={16} /></Link>}
                            {currentResource.id === "privacy" && <button type="button" onClick={() => chooseSection("privacy")} className="inline-flex items-center gap-2 rounded-full border border-border-dark px-5 py-2.5 text-sm font-semibold text-text-primary transition hover:bg-surface-secondary">Open Privacy and Safety settings <ChevronRight size={16} /></button>}
                        </div>
                        <footer className="flex flex-col gap-3 border-t border-accent-blue/20 bg-accent-blue/5 px-5 py-4 sm:flex-row sm:items-center sm:px-7">
                            <img src={brandMark} alt="" aria-hidden="true" className="h-8 w-8 shrink-0 object-contain" />
                            <div>
                                <p className="text-sm font-bold text-accent-blue">SocialSphere</p>
                                <p className="mt-0.5 text-xs leading-5 text-text-secondary">Official information for our community · Made for meaningful conversations</p>
                            </div>
                        </footer>
                    </article>}

                    {!currentResource && selectedSection === "resources" && <div className="space-y-6">
                        {["Legal", "SocialSphere"].map((group) => {
                            const groupResources = visibleResources.filter((resource) => resource.group === group);
                            if (groupResources.length === 0) return null;
                            return <section key={group} aria-labelledby={`resource-group-${group.toLowerCase()}`} className="overflow-hidden rounded-2xl border border-border-dark bg-surface-primary">
                                <h3 id={`resource-group-${group.toLowerCase()}`} className="border-b border-border-dark px-5 py-4 text-lg font-bold text-text-primary sm:px-6">{group}</h3>
                                <div className="divide-y divide-border-dark">
                                    {groupResources.map((resource) => <button key={resource.id} type="button" onClick={() => chooseResource(resource.id)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-surface-secondary sm:px-6">
                                        <span className="min-w-0"><span className="block font-semibold text-text-primary">{resource.label}</span><span className="mt-1 block text-sm leading-5 text-text-secondary">{resource.description}</span></span>
                                        <ChevronRight size={19} className="shrink-0 text-text-muted" />
                                    </button>)}
                                </div>
                            </section>;
                        })}
                        {visibleResources.length === 0 && <p className="rounded-xl border border-border-dark bg-surface-primary px-5 py-6 text-sm text-text-secondary">No resources match “{search}”.</p>}
                    </div>}

                    {!currentResource && selectedSection === "your-account" && !accountPage && <div className="divide-y divide-border-dark overflow-hidden rounded-2xl border border-border-dark bg-surface-primary">
                        <button type="button" onClick={() => chooseAccountPage("account-information")} className="flex w-full items-center gap-4 px-5 py-5 text-left transition hover:bg-surface-secondary sm:px-6">
                            <UserRound size={20} className="shrink-0 text-text-muted" />
                            <span className="min-w-0 flex-1"><span className="block font-semibold text-text-primary">Account information</span><span className="mt-1 block text-sm text-text-secondary">Display name, username, bio and email address</span></span><ChevronRight size={19} className="shrink-0 text-text-muted" />
                        </button>
                        <button type="button" onClick={() => chooseAccountPage("change-password")} className="flex w-full items-center gap-4 px-5 py-5 text-left transition hover:bg-surface-secondary sm:px-6">
                            <LockKeyhole size={20} className="shrink-0 text-text-muted" />
                            <span className="min-w-0 flex-1"><span className="block font-semibold text-text-primary">Change your password</span><span className="mt-1 block text-sm text-text-secondary">Update the password for your account</span></span><ChevronRight size={19} className="shrink-0 text-text-muted" />
                        </button>
                    </div>}

                    {!currentResource && selectedSection === "your-account" && accountPage === "account-information" && <section className="rounded-2xl border border-border-dark bg-surface-primary p-5 sm:p-6">
                        <p className="mb-5 rounded-xl bg-surface-secondary px-4 py-3 text-sm text-text-secondary">Email address <strong className="ml-1 break-all text-text-primary">{user.email || "Not available"}</strong></p>
                        <form onSubmit={(event) => void saveAccountInformation(event)} className="space-y-4">
                            <label className="block text-sm font-semibold text-text-secondary">Display name<input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label>
                            <label className="block text-sm font-semibold text-text-secondary">Username<input className={inputClass} value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={30} pattern="[A-Za-z0-9_]+" required /><span className="mt-1 block text-xs font-normal text-text-muted">3–30 letters, numbers or underscores.</span></label>
                            <label className="block text-sm font-semibold text-text-secondary">Bio<textarea className={`${inputClass} resize-y`} value={bio} onChange={(event) => setBio(event.target.value)} maxLength={160} rows={3} /></label>
                            <button disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-accent-blue px-5 py-2.5 text-sm font-bold text-white hover:bg-accent-blue-hover disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}Save account information</button>
                        </form>
                    </section>}

                    {!currentResource && selectedSection === "your-account" && accountPage === "change-password" && <section className="rounded-2xl border border-border-dark bg-surface-primary p-5 sm:p-6">
                        {user.hasPassword ? <form onSubmit={(event) => void savePassword(event)} className="space-y-4">
                            <label className="block text-sm font-semibold text-text-secondary">Current password<input className={inputClass} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
                            <label className="block text-sm font-semibold text-text-secondary">New password<input className={inputClass} type="password" autoComplete="new-password" minLength={8} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /><span className="mt-1 block text-xs font-normal text-text-muted">Must be 8–128 characters.</span></label>
                            <label className="block text-sm font-semibold text-text-secondary">Confirm new password<input className={inputClass} type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
                            <button disabled={saving} className="rounded-full border border-border-dark px-5 py-2.5 text-sm font-bold text-text-primary transition hover:bg-surface-secondary disabled:opacity-60">{saving ? "Updating…" : "Update password"}</button>
                        </form> : <div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 shrink-0 text-accent-blue" size={20} /><div><h3 className="font-bold text-text-primary">Password sign-in isn’t set up</h3><p className="mt-2 text-sm leading-6 text-text-secondary">This account currently signs in through Google, so there is no password to change. Continue using Google when you sign in.</p></div></div>}
                    </section>}

                    {!currentResource && selectedSection === "premium" && <section className="rounded-2xl border border-premium-violet/30 bg-surface-primary p-5 sm:p-6">
                        <div className="flex items-start gap-4"><div className="rounded-xl bg-premium-violet/10 p-3 text-premium-violet"><Sparkles size={22} /></div><div className="min-w-0 flex-1"><h3 className="text-lg font-bold text-text-primary">{user.entitlements?.tier || "FREE"} plan</h3><p className="mt-1 text-sm text-text-secondary">{user.entitlements?.monthlyCredits ?? 20} AI credits per month · {user.entitlements?.maxPostCharacters?.toLocaleString() ?? "280"} characters per post</p><p className="mt-3 text-sm leading-6 text-text-secondary">Compare SocialSphere plans, review your subscription, or manage billing details.</p><div className="mt-5 flex flex-wrap gap-3"><Link to="/plans" className="inline-flex items-center gap-2 rounded-full bg-premium-violet px-4 py-2.5 text-sm font-bold text-black hover:bg-purple-300">View plans <ArrowRight size={16} /></Link><Link to="/settings/billing" className="inline-flex items-center gap-2 rounded-full border border-border-dark px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-surface-secondary">Billing dashboard <CreditCard size={16} /></Link></div></div></div>
                    </section>}

                    {!currentResource && selectedSection === "privacy" && <section className="rounded-2xl border border-border-dark bg-surface-primary p-5 sm:p-6">
                        <div className="mb-5 flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-accent-blue" size={21} /><div><h3 className="font-bold text-text-primary">Account visibility</h3><p className="mt-1 text-sm leading-6 text-text-secondary">Choose whether anyone can follow you or new followers need your approval.</p></div></div>
                        <form onSubmit={(event) => void savePrivacy(event)} className="space-y-3">
                            <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${!isPrivate ? "border-accent-blue/50 bg-accent-blue/5" : "border-border-dark hover:bg-surface-secondary"}`}><input type="radio" name="account-privacy" checked={!isPrivate} onChange={() => setIsPrivate(false)} className="mt-1 accent-[#1d9bf0]" /><span><span className="block font-semibold text-text-primary">Public</span><span className="mt-1 block text-sm leading-5 text-text-secondary">Anyone can follow you and view your public posts.</span></span></label>
                            <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${isPrivate ? "border-accent-blue/50 bg-accent-blue/5" : "border-border-dark hover:bg-surface-secondary"}`}><input type="radio" name="account-privacy" checked={isPrivate} onChange={() => setIsPrivate(true)} className="mt-1 accent-[#1d9bf0]" /><span><span className="block font-semibold text-text-primary">Private</span><span className="mt-1 block text-sm leading-5 text-text-secondary">Only approved followers can see your posts. New followers need your approval.</span></span></label>
                            <button disabled={saving || isPrivate === Boolean(user.isPrivate)} className="mt-2 inline-flex items-center gap-2 rounded-full bg-accent-blue px-5 py-2.5 text-sm font-bold text-white hover:bg-accent-blue-hover disabled:cursor-not-allowed disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}Save privacy setting</button>
                        </form>
                    </section>}

                    {!currentResource && selectedSection === "notifications" && <section className="rounded-2xl border border-border-dark bg-surface-primary p-5 sm:p-6"><div className="flex items-start gap-4"><div className="rounded-xl bg-accent-blue/10 p-3 text-accent-blue"><Bell size={22} /></div><div><h3 className="font-bold text-text-primary">In-app notifications</h3><p className="mt-1 text-sm leading-6 text-text-secondary">See replies, likes, reposts, follow activity and other account updates in your Notifications feed.</p><Link to="/notifications" className="mt-5 inline-flex items-center gap-2 rounded-full bg-accent-blue px-4 py-2.5 text-sm font-bold text-white hover:bg-accent-blue-hover">Open notifications <ArrowRight size={16} /></Link></div></div></section>}

                    {!currentResource && selectedSection === "help" && <section className="rounded-2xl border border-border-dark bg-surface-primary p-5 sm:p-6"><div className="flex items-start gap-4"><div className="rounded-xl bg-accent-blue/10 p-3 text-accent-blue"><CircleHelp size={22} /></div><div><h3 className="font-bold text-text-primary">SocialSphere Help Center</h3><p className="mt-1 text-sm leading-6 text-text-secondary">Find answers about accounts, privacy, messaging, posts and subscriptions.</p><Link to="/help" className="mt-5 inline-flex items-center gap-2 rounded-full border border-border-dark px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-surface-secondary">Browse help articles <ChevronRight size={16} /></Link></div></div></section>}
                </div>
            </section>
        </main>
    );
};
