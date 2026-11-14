import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Loader2, Lock, Mail, User as UserIcon, X } from "lucide-react";
import { useAuth } from "../features/auth/hooks";
import { signInWithGooglePopup } from "../lib/firebase";
import logoImg from "../assets/socialsphere-mark.svg";

const authErrorMessage = (error: unknown, fallback: string) => {
    if (!error || typeof error !== "object") return fallback;
    const value = error as { code?: unknown; response?: { data?: { error?: unknown } }; message?: unknown };
    if (typeof value.response?.data?.error === "string") return value.response.data.error;
    if (value.code === "auth/api-key-not-valid") {
        return "Firebase rejected the web API key. Replace VITE_FIREBASE_API_KEY in client/.env with the Web API key from this Firebase project's settings, then restart Vite.";
    }
    if (value.code === "auth/operation-not-allowed") {
        return "Google sign-in is disabled for this Firebase project. Enable Google under Authentication → Sign-in method.";
    }
    return typeof value.message === "string" ? value.message : fallback;
};

export const AuthPage: React.FC = () => {
    const { login, register, googleLogin } = useAuth();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const dialogRef = useRef<HTMLDivElement>(null);
    const loadingRef = useRef(false);
    const isLoginMode = searchParams.get("mode") !== "register";
    const requestedRedirect = searchParams.get("redirect") || "/";
    const postAuthDestination = requestedRedirect.startsWith("/") && !requestedRedirect.startsWith("//") && !requestedRedirect.includes("\\") && !requestedRedirect.startsWith("/auth")
        ? requestedRedirect
        : "/";
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadingRef.current = loading;
    }, [loading]);

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        dialogRef.current?.querySelector<HTMLElement>("input")?.focus();
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !loadingRef.current) navigate("/", { replace: true });
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [navigate]);

    const switchMode = (loginMode: boolean) => {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set("mode", loginMode ? "login" : "register");
        setSearchParams(nextParams, { replace: true });
        setError("");
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError("");
        if (!email.trim() || !password) {
            setError("Enter your email address and password.");
            return;
        }
        if (!isLoginMode) {
            if (!name.trim() || !username.trim()) {
                setError("Enter your full name and username.");
                return;
            }
            if (password !== confirmPassword) {
                setError("The passwords do not match.");
                return;
            }
        }

        setLoading(true);
        try {
            if (isLoginMode) await login(email.trim(), password);
            else await register(name.trim(), email.trim(), username.trim(), password);
            navigate(postAuthDestination, { replace: true });
        } catch (authError: unknown) {
            setError(authErrorMessage(authError, "Authentication failed. Please try again."));
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setError("");
        setLoading(true);
        try {
            const idToken = await signInWithGooglePopup();
            await googleLogin(idToken);
            navigate(postAuthDestination, { replace: true });
        } catch (authError: unknown) {
            setError(authErrorMessage(authError, "Google authentication failed."));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget && !loading) navigate("/", { replace: true });
            }}
        >
            <section
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="auth-title"
                aria-describedby={error ? "auth-error" : undefined}
                onKeyDown={(event) => {
                    if (event.key !== "Tab") return;
                    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
                        'button:not([disabled]), input:not([disabled])'
                    );
                    if (!focusable?.length) return;
                    const first = focusable[0];
                    const last = focusable[focusable.length - 1];
                    if (event.shiftKey && document.activeElement === first) {
                        event.preventDefault();
                        last?.focus();
                    } else if (!event.shiftKey && document.activeElement === last) {
                        event.preventDefault();
                        first?.focus();
                    }
                }}
                className="relative my-auto w-full max-w-md rounded-3xl border border-border-dark bg-surface-card p-7 shadow-2xl shadow-black sm:p-9"
            >
                <button
                    type="button"
                    onClick={() => navigate("/", { replace: true })}
                    disabled={loading}
                    aria-label="Close authentication dialog"
                    className="absolute right-4 top-4 rounded-full p-2 text-text-muted transition hover:bg-white/10 hover:text-white disabled:opacity-50"
                >
                    <X size={20} />
                </button>

                <div className="mb-6 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-accent-blue/30 bg-surface-primary p-2">
                        <img src={logoImg} alt="SocialSphere" className="h-full w-full rounded-full object-contain" />
                    </div>
                    <h1 id="auth-title" className="text-2xl font-extrabold tracking-tight text-white">
                        {isLoginMode ? "Sign in to SocialSphere" : "Create your account"}
                    </h1>
                    <p className="mt-1.5 text-sm text-text-secondary">
                        {isLoginMode ? "Welcome back. Continue with your email or Google." : "Join the conversation on SocialSphere."}
                    </p>
                </div>

                {error && (
                    <p id="auth-error" role="alert" className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-center text-sm text-red-400">
                        {error}
                    </p>
                )}

                <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                    {!isLoginMode && (
                        <>
                            <label className="relative block">
                                <span className="sr-only">Full name</span>
                                <UserIcon size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                                <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={80} required placeholder="Full name" className="w-full rounded-full border border-border-dark bg-surface-input py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none focus:ring-1 focus:ring-accent-blue" />
                            </label>
                            <label className="relative block">
                                <span className="sr-only">Username</span>
                                <UserIcon size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                                <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" minLength={3} maxLength={30} required placeholder="Username" className="w-full rounded-full border border-border-dark bg-surface-input py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none focus:ring-1 focus:ring-accent-blue" />
                            </label>
                        </>
                    )}

                    <label className="relative block">
                        <span className="sr-only">Email address</span>
                        <Mail size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="Email address" className="w-full rounded-full border border-border-dark bg-surface-input py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none focus:ring-1 focus:ring-accent-blue" />
                    </label>

                    <label className="relative block">
                        <span className="sr-only">Password</span>
                        <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isLoginMode ? "current-password" : "new-password"} minLength={6} required placeholder="Password" className="w-full rounded-full border border-border-dark bg-surface-input py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none focus:ring-1 focus:ring-accent-blue" />
                    </label>

                    {!isLoginMode && (
                        <label className="relative block">
                            <span className="sr-only">Confirm password</span>
                            <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                            <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={6} required placeholder="Confirm password" className="w-full rounded-full border border-border-dark bg-surface-input py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none focus:ring-1 focus:ring-accent-blue" />
                        </label>
                    )}

                    <button type="submit" disabled={loading} className="mt-1 flex w-full items-center justify-center gap-2 rounded-full bg-accent-blue px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-accent-blue/25 transition hover:bg-accent-blue-hover disabled:cursor-not-allowed disabled:opacity-50">
                        {loading ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                        <span>{loading ? "Please wait…" : isLoginMode ? "Sign in" : "Create account"}</span>
                    </button>
                </form>

                <div className="my-4 flex items-center text-xs text-text-muted">
                    <div className="h-px flex-1 bg-border-dark" /><span className="px-3">or</span><div className="h-px flex-1 bg-border-dark" />
                </div>

                <button type="button" onClick={handleGoogleSignIn} disabled={loading} className="flex w-full items-center justify-center gap-2.5 rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50">
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.87c2.26-2.09 3.67-5.17 3.67-9.15z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.87-3.05c-1.08.72-2.45 1.16-4.06 1.16-3.13 0-5.78-2.11-6.73-4.96H1.25v3.15C3.25 21.36 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.24c-.25-.72-.38-1.49-.38-2.24s.13-1.52.38-2.24V6.61H1.25C.45 8.22 0 10.06 0 12s.45 3.78 1.25 5.39l4.02-3.15z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.64 1.25 6.61l4.02 3.15c.95-2.85 3.6-4.96 6.73-4.96z"/></svg>
                    <span>{loading ? "Connecting…" : "Continue with Google"}</span>
                </button>

                <p className="mt-5 text-center text-xs text-text-secondary">
                    {isLoginMode ? "Don't have an account?" : "Already have an account?"}{" "}
                    <button type="button" onClick={() => switchMode(!isLoginMode)} disabled={loading} className="font-bold text-accent-blue underline hover:brightness-110 disabled:opacity-50">
                        {isLoginMode ? "Sign up" : "Log in"}
                    </button>
                </p>
            </section>
        </div>
    );
};
