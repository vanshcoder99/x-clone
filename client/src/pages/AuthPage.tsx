import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight, Lock, Mail, User as UserIcon } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";

export const AuthPage: React.FC = () => {
    const { login, register } = useAuth();
    const navigate = useNavigate();

    const [isLoginMode, setIsLoginMode] = useState(true);
    const [identifier, setIdentifier] = useState("");
    const [email, setEmail] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            if (isLoginMode) {
                await login(identifier, password);
            } else {
                await register(email, username, password);
            }
            navigate("/");
        } catch (err: any) {
            setError(err.response?.data?.error || "Authentication failed. Please verify credentials.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            style={{
                minHeight: "100vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "var(--bg-primary)",
                padding: "20px",
                background: "radial-gradient(circle at 50% 30%, #161c28 0%, #000000 70%)",
            }}
        >
            <div
                className="modal-card"
                style={{
                    maxWidth: "460px",
                    padding: "36px 32px",
                    border: "1px solid var(--border-color)",
                    boxShadow: "0 16px 50px rgba(0,0,0,0.8)",
                }}
            >
                {/* Brand Header */}
                <div style={{ textAlign: "center", marginBottom: "28px" }}>
                    <div
                        className="brand-icon"
                        style={{
                            width: "52px",
                            height: "52px",
                            margin: "0 auto 14px",
                            borderRadius: "16px",
                        }}
                    >
                        <Sparkles size={28} />
                    </div>
                    <h1 style={{ fontSize: "1.75rem", fontWeight: 800, letterSpacing: "-0.5px" }}>
                        {isLoginMode ? "Sign in to SocialSphere" : "Join SocialSphere today"}
                    </h1>
                    <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", marginTop: "6px" }}>
                        {isLoginMode
                            ? "Welcome back! Enter your details to continue."
                            : "Create an account to start sharing and connecting."}
                    </p>
                </div>

                {error && (
                    <div
                        style={{
                            background: "rgba(249, 24, 128, 0.12)",
                            border: "1px solid rgba(249, 24, 128, 0.4)",
                            color: "var(--accent-pink)",
                            padding: "10px 14px",
                            borderRadius: "var(--radius-sm)",
                            fontSize: "0.9rem",
                            marginBottom: "18px",
                            textAlign: "center",
                        }}
                    >
                        {error}
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    {isLoginMode ? (
                        <div style={{ position: "relative" }}>
                            <Mail size={18} className="search-icon" style={{ left: "14px" }} />
                            <input
                                type="text"
                                placeholder="Username or Email"
                                value={identifier}
                                onChange={(e) => setIdentifier(e.target.value)}
                                required
                                className="search-input"
                                style={{ paddingLeft: "42px" }}
                            />
                        </div>
                    ) : (
                        <>
                            <div style={{ position: "relative" }}>
                                <Mail size={18} className="search-icon" style={{ left: "14px" }} />
                                <input
                                    type="email"
                                    placeholder="Email address"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="search-input"
                                    style={{ paddingLeft: "42px" }}
                                />
                            </div>

                            <div style={{ position: "relative" }}>
                                <UserIcon size={18} className="search-icon" style={{ left: "14px" }} />
                                <input
                                    type="text"
                                    placeholder="Username"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    required
                                    className="search-input"
                                    style={{ paddingLeft: "42px" }}
                                />
                            </div>
                        </>
                    )}

                    <div style={{ position: "relative" }}>
                        <Lock size={18} className="search-icon" style={{ left: "14px" }} />
                        <input
                            type="password"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            className="search-input"
                            style={{ paddingLeft: "42px" }}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="tweet-btn-large"
                        style={{ marginTop: "10px", width: "100%", justifyContent: "center" }}
                    >
                        <span>{loading ? "Authenticating..." : isLoginMode ? "Sign In" : "Create Account"}</span>
                        <ArrowRight size={18} />
                    </button>
                </form>

                {/* Divider */}
                <div style={{ display: "flex", alignItems: "center", margin: "20px 0 16px", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border-color)" }} />
                    <span style={{ padding: "0 12px" }}>or</span>
                    <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border-color)" }} />
                </div>

                {/* Google Sign In Button */}
                <button
                    type="button"
                    onClick={() => {
                        const tokenPrompt = prompt("Enter Google Firebase ID Token for verification:");
                        if (tokenPrompt) {
                            setLoading(true);
                            api.post("/auth/google", { idToken: tokenPrompt })
                                .then(() => navigate("/"))
                                .catch((err: any) => setError(err.response?.data?.error || "Google authentication failed"))
                                .finally(() => setLoading(false));
                        }
                    }}
                    className="tweet-btn-large"
                    style={{
                        background: "#ffffff",
                        color: "#000000",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "10px",
                        boxShadow: "none",
                        width: "100%",
                    }}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.87c2.26-2.09 3.67-5.17 3.67-9.15z"/>
                        <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.87-3.05c-1.08.72-2.45 1.16-4.06 1.16-3.13 0-5.78-2.11-6.73-4.96H1.25v3.15C3.25 21.36 7.31 24 12 24z"/>
                        <path fill="#FBBC05" d="M5.27 14.24c-.25-.72-.38-1.49-.38-2.24s.13-1.52.38-2.24V6.61H1.25C.45 8.22 0 10.06 0 12s.45 3.78 1.25 5.39l4.02-3.15z"/>
                        <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.64 1.25 6.61l4.02 3.15c.95-2.85 3.6-4.96 6.73-4.96z"/>
                    </svg>
                    <span>Sign in with Google</span>
                </button>

                {/* Switch Login / Register Mode */}
                <div style={{ textAlign: "center", marginTop: "24px", color: "var(--text-secondary)", fontSize: "0.92rem" }}>
                    {isLoginMode ? "Don't have an account? " : "Already have an account? "}
                    <span
                        onClick={() => {
                            setIsLoginMode(!isLoginMode);
                            setError("");
                        }}
                        style={{
                            color: "var(--accent-blue)",
                            fontWeight: 700,
                            cursor: "pointer",
                            textDecoration: "underline",
                        }}
                    >
                        {isLoginMode ? "Sign up" : "Log in"}
                    </span>
                </div>
            </div>
        </div>
    );
};
