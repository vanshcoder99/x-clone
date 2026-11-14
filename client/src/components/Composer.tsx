import React, { useState, useRef, useEffect } from "react";
import {
    Sparkles,
    Image,
    Loader2,
    X,
    Upload,
    RotateCw,
    Smile,
    Film,
    BarChart2,
    Search,
    Check,
    RefreshCw,
    Bot,
    Plus,
} from "lucide-react";
import EmojiPicker, { Theme as EmojiTheme, type EmojiClickData } from "emoji-picker-react";
import { api } from "../api/client";
import { useAuth } from "../features/auth/hooks";
import { useTheme } from "../features/theme/hooks";
import type { Tweet } from "../types";
import { canUseAIAction, countCharacters } from "../lib/plan-utils";
import { Link } from "react-router-dom";

interface ComposerProps {
    onTweetPosted: (tweet: Tweet) => void;
    placeholder?: string;
    parentTweetId?: string; // If replying
    onSuccess?: () => void;
}

export interface ComposerAttachment {
    id: string;
    file?: File;
    previewUrl: string;
    mediaType: "IMAGE" | "VIDEO" | "GIF";
    status: "uploading" | "success" | "error";
    progress: number;
    error?: string;
    url?: string;
    publicId?: string;
}

interface GifItem {
    id: string;
    title?: string;
    images?: {
        fixed_height?: { url?: string };
        downsized?: { url?: string };
        original?: { url?: string };
    };
}

const formatErrorMessage = (error: unknown, fallback: string) => {
    if (!error || typeof error !== "object") return fallback;
    const value = error as { response?: { data?: { error?: unknown } }; message?: unknown };
    if (typeof value.response?.data?.error === "string") return value.response.data.error;
    return typeof value.message === "string" ? value.message : fallback;
};

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB
const GIPHY_API_KEY =
    import.meta.env.VITE_GIPHY_API_KEY || "sXpGFDGZs0Dv1mmNFvYaGUvYwKX0PWIh";

type AiAction =
    | "improve"
    | "grammar"
    | "expand"
    | "alternatives"
    | "professional"
    | "casual"
    | "friendly"
    | "humorous"
    | "engaging"
    | "hashtags";

const AI_CAPABILITIES: { id: AiAction; label: string; icon: string }[] = [
    { id: "improve", label: "Improve Tweet", icon: "✨" },
    { id: "grammar", label: "Fix Grammar", icon: "✍️" },
    { id: "expand", label: "Expand Idea", icon: "🧵" },
    { id: "alternatives", label: "3 Alternatives", icon: "🔀" },
    { id: "professional", label: "Professional", icon: "💼" },
    { id: "casual", label: "Casual", icon: "☕" },
    { id: "friendly", label: "Friendly", icon: "🤝" },
    { id: "humorous", label: "Humorous", icon: "😂" },
    { id: "engaging", label: "Viral Hook", icon: "🚀" },
    { id: "hashtags", label: "Hashtags", icon: "#️⃣" },
];

export const Composer: React.FC<ComposerProps> = ({
    onTweetPosted,
    placeholder = "What is happening?!",
    parentTweetId,
    onSuccess,
}) => {
    const { user } = useAuth();
    const { theme } = useTheme();

    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const emojiPickerRef = useRef<HTMLDivElement | null>(null);
    const gifPanelRef = useRef<HTMLDivElement | null>(null);
    const attachmentsRef = useRef<ComposerAttachment[]>([]);
    const postingRef = useRef(false);

    // Core content state
    const [content, setContent] = useState("");
    const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
    const [manualUrl, setManualUrl] = useState("");
    const [showMediaInput, setShowMediaInput] = useState(false);
    const [isPosting, setIsPosting] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");

    // Emoji Picker state
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);

    // GIPHY state
    const [showGifModal, setShowGifModal] = useState(false);
    const [gifQuery, setGifQuery] = useState("");
    const [gifs, setGifs] = useState<GifItem[]>([]);
    const [isGifsLoading, setIsGifsLoading] = useState(false);
    const [gifError, setGifError] = useState("");

    // OpenRouter AI Suggest state
    const [showAiModal, setShowAiModal] = useState(false);
    const [aiPrompt, setAiPrompt] = useState("");
    const [aiAction, setAiAction] = useState<AiAction>("improve");
    const [aiSuggestion, setAiSuggestion] = useState("");
    const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
    const [aiHashtags, setAiHashtags] = useState<string[]>([]);
    const [aiModel, setAiModel] = useState("");
    const [aiProvider, setAiProvider] = useState("");
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [aiError, setAiError] = useState("");
    const [aiCreditsRemaining, setAiCreditsRemaining] = useState<number | null>(user?.entitlements?.creditsRemaining ?? null);
    const currentEntitlementCredits = user?.entitlements?.creditsRemaining;

    useEffect(() => {
        if (typeof currentEntitlementCredits === "number") setAiCreditsRemaining(currentEntitlementCredits);
    }, [currentEntitlementCredits]);

    const maxChars = user?.entitlements?.maxPostCharacters ?? 280;
    const remainingChars = maxChars - countCharacters(content);
    const isOverLimit = remainingChars < 0;

    const hasUploading = attachments.some((a) => a.status === "uploading");
    const hasError = attachments.some((a) => a.status === "error");

    useEffect(() => {
        attachmentsRef.current = attachments;
    }, [attachments]);

    useEffect(() => () => {
        attachmentsRef.current.forEach((attachment) => {
            if (attachment.previewUrl.startsWith("blob:")) URL.revokeObjectURL(attachment.previewUrl);
        });
    }, []);

    // Close Emoji Picker on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                emojiPickerRef.current &&
                !emojiPickerRef.current.contains(e.target as Node)
            ) {
                setShowEmojiPicker(false);
            }
        };

        if (showEmojiPicker) {
            document.addEventListener("mousedown", handleClickOutside);
            return () => document.removeEventListener("mousedown", handleClickOutside);
        }
    }, [showEmojiPicker]);

    // Handle GIPHY Search & Trending
    useEffect(() => {
        if (!showGifModal) return;

        let isSubscribed = true;
        const timer = setTimeout(async () => {
            setIsGifsLoading(true);
            setGifError("");
            try {
                const endpoint = gifQuery.trim()
                    ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(
                          gifQuery.trim()
                      )}&limit=18&rating=g`
                    : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=18&rating=g`;

                const res = await fetch(endpoint);
                if (!res.ok) {
                    throw new Error(`GIPHY error (${res.status})`);
                }
                const data = await res.json() as { data?: GifItem[] };
                if (isSubscribed) {
                    setGifs(data.data || []);
                }
            } catch (err: unknown) {
                if (isSubscribed) {
                    console.error("GIPHY fetch failed:", err);
                    setGifError("Unable to load GIFs. Please check your connection.");
                }
            } finally {
                if (isSubscribed) {
                    setIsGifsLoading(false);
                }
            }
        }, 300);

        return () => {
            isSubscribed = false;
            clearTimeout(timer);
        };
    }, [showGifModal, gifQuery]);

    // Emoji Insertion with Cursor Preservation
    const handleEmojiClick = (emojiData: EmojiClickData) => {
        const emoji = emojiData.emoji;
        const textarea = textareaRef.current;

        if (!textarea) {
            setContent((prev) => prev + emoji);
            return;
        }

        const start = textarea.selectionStart ?? content.length;
        const end = textarea.selectionEnd ?? content.length;

        const newContent = content.slice(0, start) + emoji + content.slice(end);
        setContent(newContent);

        requestAnimationFrame(() => {
            textarea.focus();
            const newCursor = start + emoji.length;
            textarea.setSelectionRange(newCursor, newCursor);
        });
    };

    // Upload the selected file as multipart/form-data; the server returns its persisted Cloudinary URL.
    const uploadFile = async (attachmentId: string, file: File) => {
        try {
            const formData = new FormData();
            formData.append("file", file);
            const { data } = await api.post("/media/upload", formData, {
                // Large files may need longer than the API client's default 10s timeout
                // while the server streams them to Cloudinary.
                timeout: 180000,
                onUploadProgress: (event) => {
                    if (!event.total) return;
                    const progress = Math.min(95, Math.round((event.loaded / event.total) * 95));
                    setAttachments((prev) => prev.map((attachment) =>
                        attachment.id === attachmentId ? { ...attachment, progress } : attachment
                    ));
                },
            });

            if (typeof data.url !== "string" || !data.url.startsWith("https://") || typeof data.publicId !== "string") {
                throw new Error("The server did not return a valid Cloudinary media URL.");
            }

            setAttachments((prev) =>
                prev.map((att) =>
                    att.id === attachmentId
                        ? {
                              ...att,
                              status: "success",
                              url: data.url,
                              publicId: data.publicId,
                              progress: 100,
                          }
                        : att
                )
            );
        } catch (err: unknown) {
            console.error("Upload error:", err);
            setAttachments((prev) =>
                prev.map((att) =>
                    att.id === attachmentId
                        ? {
                              ...att,
                              status: "error",
                              error: formatErrorMessage(err, "Upload failed"),
                          }
                        : att
                )
            );
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        setErrorMessage("");

        if (attachments.length + files.length > 4) {
            setErrorMessage("You can attach up to 4 media files per post.");
            return;
        }

        const newAttachments: ComposerAttachment[] = [];

        for (const file of files) {
            const isVideo = file.type.startsWith("video/");
            const isImage = file.type.startsWith("image/");
            const isGif = file.type === "image/gif";

            if (!isVideo && !isImage) {
                setErrorMessage(
                    `Unsupported file format '${file.name}'. Only images and videos are allowed.`
                );
                return;
            }

            if (isVideo && file.size > MAX_VIDEO_SIZE) {
                setErrorMessage(`Video '${file.name}' exceeds maximum size of 50MB.`);
                return;
            }

            if (isImage && file.size > MAX_IMAGE_SIZE) {
                setErrorMessage(`Image '${file.name}' exceeds maximum size of 10MB.`);
                return;
            }

            const attachmentId = `${Date.now()}_${Math.random()
                .toString(36)
                .slice(2, 7)}`;
            const previewUrl = URL.createObjectURL(file);
            const mediaType: "IMAGE" | "VIDEO" | "GIF" = isVideo
                ? "VIDEO"
                : isGif
                ? "GIF"
                : "IMAGE";

            const item: ComposerAttachment = {
                id: attachmentId,
                file,
                previewUrl,
                mediaType,
                status: "uploading",
                progress: 10,
            };

            newAttachments.push(item);
            uploadFile(attachmentId, file);
        }

        setAttachments((prev) => [...prev, ...newAttachments]);
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    const handleSelectGif = (gif: GifItem) => {
        if (attachments.length >= 4) {
            setErrorMessage("Maximum 4 attachments allowed.");
            setShowGifModal(false);
            return;
        }

        const previewUrl =
            gif.images?.fixed_height?.url ||
            gif.images?.downsized?.url ||
            gif.images?.original?.url;
        if (!previewUrl) {
            setErrorMessage("This GIF does not have a usable preview URL.");
            return;
        }
        const fullUrl = gif.images?.original?.url || previewUrl;

        const newAttachment: ComposerAttachment = {
            id: `giphy_${gif.id}_${Date.now()}`,
            previewUrl,
            url: fullUrl,
            mediaType: "GIF",
            status: "success",
            progress: 100,
        };

        setAttachments((prev) => [...prev, newAttachment]);
        setShowGifModal(false);
        setGifQuery("");
    };

    const handleAddManualUrl = () => {
        const clean = manualUrl.trim();
        if (!clean) return;

        if (attachments.length >= 4) {
            setErrorMessage("Maximum 4 media attachments allowed.");
            return;
        }

        const isVideo = /\.(mp4|webm|mov)(\?.*)?$/i.test(clean);
        const isGif = /\.gif(\?.*)?$/i.test(clean);
        const mediaType: "IMAGE" | "VIDEO" | "GIF" = isVideo
            ? "VIDEO"
            : isGif
            ? "GIF"
            : "IMAGE";

        const newAttachment: ComposerAttachment = {
            id: `url_${Date.now()}`,
            previewUrl: clean,
            url: clean,
            mediaType,
            status: "success",
            progress: 100,
        };

        setAttachments((prev) => [...prev, newAttachment]);
        setManualUrl("");
        setShowMediaInput(false);
    };

    const handleRemoveAttachment = (id: string) => {
        setAttachments((prev) => {
            const target = prev.find((a) => a.id === id);
            if (target && target.previewUrl.startsWith("blob:")) {
                URL.revokeObjectURL(target.previewUrl);
            }
            return prev.filter((a) => a.id !== id);
        });
    };

    const handleRetry = (att: ComposerAttachment) => {
        if (!att.file) return;
        setAttachments((prev) =>
            prev.map((a) =>
                a.id === att.id
                    ? { ...a, status: "uploading", error: undefined, progress: 10 }
                    : a
            )
        );
        uploadFile(att.id, att.file);
    };

    // OpenRouter AI Generation Handler
    const handleGenerateAi = async (promptText: string, action: AiAction) => {
        if (!canUseAIAction(user?.entitlements?.tier, action)) {
            setAiError("This AI capability is part of a higher plan. View plans to upgrade.");
            return;
        }
        if ((aiCreditsRemaining ?? user?.entitlements?.creditsRemaining ?? 0) < 1) {
            setAiError("You have no AI credits remaining this period. View plans to upgrade.");
            return;
        }
        const queryPrompt = promptText.trim() || content.trim();
        if (!queryPrompt) {
            setAiError("Please type a topic, thought or draft in the box above.");
            return;
        }

        setIsAiLoading(true);
        setAiError("");
        const idempotencyKey = globalThis.crypto?.randomUUID?.() || `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        try {
            if (action === "hashtags") {
                const { data } = await api.post("/ai/suggest-hashtags", {
                    content: queryPrompt,
                }, { headers: { "Idempotency-Key": idempotencyKey } });
                if (typeof data.creditsRemaining === "number") setAiCreditsRemaining(data.creditsRemaining);
                setAiHashtags(data.hashtags || []);
                setAiModel(data.model || "openai/gpt-4o-mini");
                setAiProvider(data.provider || "OpenRouter");
                setAiSuggestions([]);
                setAiSuggestion("");
            } else {
                const { data } = await api.post("/ai/suggest-tweet", {
                    prompt: queryPrompt,
                    action,
                    tone: action,
                }, { headers: { "Idempotency-Key": idempotencyKey } });
                if (typeof data.creditsRemaining === "number") setAiCreditsRemaining(data.creditsRemaining);

                if (data.suggestions && data.suggestions.length > 1) {
                    setAiSuggestions(data.suggestions);
                    setAiSuggestion(data.suggestions[0]);
                } else if (data.suggestion) {
                    setAiSuggestion(data.suggestion);
                    setAiSuggestions([data.suggestion]);
                }
                setAiHashtags([]);
                setAiModel(data.model || "openai/gpt-4o-mini");
                setAiProvider(data.provider || "OpenRouter");
            }
        } catch (err: unknown) {
            console.error("OpenRouter AI suggest error:", err);
            if ((err as { response?: { data?: { code?: string } } })?.response?.data?.code === "AI_CREDITS_EXHAUSTED") {
                setAiCreditsRemaining(0);
            }
            setAiError(formatErrorMessage(err, "Failed to generate AI suggestion from OpenRouter."));
        } finally {
            setIsAiLoading(false);
        }
    };

    const handleApplyAiSuggestion = (textToApply?: string) => {
        const text = textToApply || aiSuggestion;
        if (text) {
            setContent(text);
            setShowAiModal(false);
            setAiSuggestion("");
            setAiSuggestions([]);
            setAiHashtags([]);
        }
    };

    const handleAppendHashtag = (tag: string) => {
        setContent((prev) => (prev ? `${prev.trim()} ${tag}` : tag));
    };

    const handleAppendAllHashtags = () => {
        if (aiHashtags.length > 0) {
            const tagsText = aiHashtags.join(" ");
            setContent((prev) => (prev ? `${prev.trim()} ${tagsText}` : tagsText));
            setShowAiModal(false);
            setAiHashtags([]);
        }
    };

    const handlePost = async () => {
        // React state updates on the next render, so two rapid clicks can enter
        // this handler before `isPosting` becomes true. Keep a synchronous lock
        // to avoid submitting the same one-time media upload twice.
        if (postingRef.current || !content.trim() || isOverLimit || isPosting || hasUploading || hasError)
            return;

        postingRef.current = true;
        setIsPosting(true);
        setErrorMessage("");

        const validMedia = attachments
            .filter((a) => a.status === "success" && a.url)
            .map((a) => ({
                url: a.url!,
                publicId: a.publicId || null,
                mediaType: a.mediaType,
            }));

        try {
            if (parentTweetId) {
                // Thread reply
                const { data } = await api.post(`/tweets/${parentTweetId}/reply`, {
                    content,
                    media: validMedia,
                    mediaUrl: validMedia[0]?.url || null,
                    mediaType: validMedia[0]?.mediaType || null,
                }, { timeout: 60000 });
                onTweetPosted(data.reply);
            } else {
                // Root tweet
                const { data } = await api.post("/tweets", {
                    content,
                    media: validMedia,
                    mediaUrl: validMedia[0]?.url || null,
                    mediaType: validMedia[0]?.mediaType || null,
                }, { timeout: 60000 });
                onTweetPosted(data.tweet);
            }

            attachments.forEach((attachment) => {
                if (attachment.previewUrl.startsWith("blob:")) URL.revokeObjectURL(attachment.previewUrl);
            });
            setContent("");
            setAttachments([]);
            setManualUrl("");
            setShowMediaInput(false);
            if (onSuccess) onSuccess();
        } catch (err: unknown) {
            setErrorMessage(formatErrorMessage(err, "Failed to post. Please try again."));
        } finally {
            postingRef.current = false;
            setIsPosting(false);
        }
    };

    return (
        <div className="flex gap-3 px-4 py-3.5 border-b border-border-dark bg-surface-primary/40 relative">
            <img
                src={
                    user?.avatarUrl ||
                    `https://api.dicebear.com/7.x/identicon/svg?seed=${
                        user?.username || "guest"
                    }`
                }
                alt="Avatar"
                className="w-10 h-10 rounded-full object-cover bg-surface-secondary border border-border-dark flex-shrink-0"
            />

            <div className="flex-1 min-w-0">
                <textarea
                    ref={textareaRef}
                    className="w-full bg-transparent border-none outline-none text-text-primary text-base placeholder:text-text-muted resize-none min-h-[75px] leading-relaxed font-sans"
                    placeholder={placeholder}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                />
                {isOverLimit && (
                    <p className="-mt-2 mb-3 text-xs text-amber-300">
                        Your {maxChars.toLocaleString()} character plan limit is exceeded. <Link to="/plans" className="font-bold underline">Upgrade your plan</Link> for longer posts.
                    </p>
                )}

                {/* Media Input Drawer (External URL) */}
                {showMediaInput && (
                    <div className="flex gap-2 my-2">
                        <input
                            type="text"
                            placeholder="Enter image, video or GIF URL (e.g. https://...)"
                            value={manualUrl}
                            onChange={(e) => setManualUrl(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    handleAddManualUrl();
                                }
                            }}
                            className="flex-1 bg-surface-card border border-border-dark rounded-full py-2 px-4 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:bg-black focus:outline-none focus:ring-1 focus:ring-accent-blue transition-all"
                        />
                        <button
                            type="button"
                            onClick={handleAddManualUrl}
                            className="text-accent-blue hover:bg-accent-blue/15 p-2 rounded-full transition-colors cursor-pointer"
                            title="Add URL"
                        >
                            <Upload size={18} />
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setShowMediaInput(false);
                                setManualUrl("");
                            }}
                            className="text-text-muted hover:bg-white/10 p-2 rounded-full transition-colors cursor-pointer"
                            title="Cancel"
                        >
                            <X size={18} />
                        </button>
                    </div>
                )}

                {/* GIPHY GIF Search Panel */}
                {showGifModal && (
                    <div
                        ref={gifPanelRef}
                        className="my-3 p-3 bg-surface-card border border-border-dark rounded-2xl shadow-2xl relative z-30"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-sm text-text-primary flex items-center gap-1.5">
                                <span className="text-xs px-1.5 py-0.5 rounded bg-accent-blue/20 text-accent-blue font-black">
                                    GIF
                                </span>
                                Choose a GIF
                            </span>
                            <button
                                type="button"
                                onClick={() => setShowGifModal(false)}
                                className="text-text-muted hover:text-text-primary p-1 rounded-full hover:bg-white/10 transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="relative mb-2.5">
                            <input
                                type="text"
                                placeholder="Search for GIFs on GIPHY..."
                                value={gifQuery}
                                onChange={(e) => setGifQuery(e.target.value)}
                                className="w-full bg-surface-primary border border-border-dark rounded-full py-2 pl-9 pr-8 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none transition-all"
                                autoFocus
                            />
                            <Search
                                size={14}
                                className="absolute left-3 top-2.5 text-text-muted"
                            />
                            {gifQuery && (
                                <button
                                    type="button"
                                    onClick={() => setGifQuery("")}
                                    className="absolute right-2.5 top-2.5 text-text-muted hover:text-white"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        {/* GIF Previews Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto overscroll-contain pr-1">
                            {isGifsLoading ? (
                                <div className="col-span-full py-10 flex flex-col items-center justify-center text-text-muted gap-2">
                                    <Loader2 size={24} className="animate-spin text-accent-blue" />
                                    <span className="text-xs">Finding GIFs...</span>
                                </div>
                            ) : gifError ? (
                                <div className="col-span-full py-8 text-center text-red-400 text-xs">
                                    <p>{gifError}</p>
                                    <button
                                        type="button"
                                        onClick={() => setGifQuery(gifQuery ? gifQuery + " " : "")}
                                        className="mt-2 text-accent-blue hover:underline font-bold"
                                    >
                                        Retry
                                    </button>
                                </div>
                            ) : gifs.length === 0 ? (
                                <div className="col-span-full py-8 text-center text-text-muted text-xs">
                                    No GIFs found for "{gifQuery}". Try another keyword!
                                </div>
                            ) : (
                                gifs.map((g) => (
                                    <div
                                        key={g.id}
                                        className="relative aspect-video rounded-lg overflow-hidden bg-surface-secondary cursor-pointer hover:opacity-85 transition-opacity group border border-white/5"
                                        onClick={() => handleSelectGif(g)}
                                    >
                                        <img
                                            src={
                                                g.images?.fixed_height?.url ||
                                                g.images?.original?.url
                                            }
                                            alt={g.title || "GIF"}
                                            className="w-full h-full object-cover"
                                            loading="lazy"
                                        />
                                    </div>
                                ))
                            )}
                        </div>

                        {/* GIPHY Attribution */}
                        <div className="flex items-center justify-between pt-2 mt-2 border-t border-border-dark text-[0.65rem] text-text-muted">
                            <span>{gifQuery ? "Search results" : "Trending now"}</span>
                            <span className="font-extrabold tracking-wider text-text-secondary">
                                POWERED BY GIPHY
                            </span>
                        </div>
                    </div>
                )}

                {/* Multi-Media Attachment Previews */}
                {attachments.length > 0 && (
                    <div
                        className={`grid gap-2 mt-2.5 rounded-xl overflow-hidden ${
                            attachments.length === 1 ? "grid-cols-1" : "grid-cols-2"
                        }`}
                    >
                        {attachments.map((att) => (
                            <div
                                key={att.id}
                                className="relative rounded-xl overflow-hidden h-40 bg-black border border-border-dark"
                            >
                                {att.mediaType === "VIDEO" ? (
                                    <video
                                        src={att.previewUrl}
                                        className="w-full h-full object-cover block"
                                        controls={false}
                                        muted
                                    />
                                ) : (
                                    <img
                                        src={att.previewUrl}
                                        alt="Preview"
                                        className="w-full h-full object-cover block"
                                    />
                                )}

                                <button
                                    type="button"
                                    onClick={() => handleRemoveAttachment(att.id)}
                                    className="absolute top-1.5 right-1.5 bg-black/75 hover:bg-red-600/90 text-white rounded-full w-6 h-6 flex items-center justify-center cursor-pointer transition-colors z-10"
                                    title="Remove attachment"
                                >
                                    <X size={14} />
                                </button>

                                <span className="absolute bottom-1.5 left-1.5 bg-black/80 text-white text-[0.65rem] font-bold px-1.5 py-0.5 rounded tracking-wide z-10">
                                    {att.mediaType}
                                </span>

                                {att.status === "uploading" && (
                                    <div className="absolute inset-0 bg-black/65 flex flex-col items-center justify-center gap-1.5 text-white text-xs z-10">
                                        <Loader2
                                            size={24}
                                            className="animate-spin text-accent-blue"
                                        />
                                        <span>Uploading… {att.progress}%</span>
                                    </div>
                                )}

                                {att.status === "error" && (
                                    <div className="absolute inset-0 bg-red-900/85 flex flex-col items-center justify-center gap-1 text-white p-2 text-center z-10">
                                        <span className="text-[0.72rem]">
                                            {att.error || "Upload failed"}
                                        </span>
                                        {att.file && (
                                            <button
                                                type="button"
                                                onClick={() => handleRetry(att)}
                                                className="mt-1 bg-accent-blue text-white text-[0.7rem] font-bold px-2.5 py-1 rounded cursor-pointer"
                                            >
                                                <RotateCw size={11} className="inline mr-1" />
                                                Retry
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {errorMessage && (
                    <p className="text-red-400 text-xs mt-1.5">{errorMessage}</p>
                )}

                {/* Toolbar */}
                <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-white/5">
                    <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
                        <input
                            type="file"
                            ref={fileInputRef}
                            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
                            multiple
                            className="hidden"
                            onChange={handleFileSelect}
                        />

                        {/* Media Upload Button */}
                        <button
                            type="button"
                            className="text-accent-blue hover:bg-accent-blue/15 p-2 rounded-full transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Media (Images & Videos)"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={attachments.length >= 4}
                        >
                            <Image size={19} />
                        </button>

                        {/* GIPHY GIF Button */}
                        <button
                            type="button"
                            className={`p-2 rounded-full transition-colors cursor-pointer flex items-center justify-center ${
                                showGifModal
                                    ? "bg-accent-blue/20 text-accent-blue"
                                    : "text-accent-blue hover:bg-accent-blue/15"
                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                            title="Add a GIF"
                            onClick={() => {
                                setShowGifModal(!showGifModal);
                                setShowEmojiPicker(false);
                            }}
                            disabled={attachments.length >= 4}
                        >
                            <span className="font-extrabold text-[0.7rem] tracking-tight border border-current px-1 py-0.5 rounded leading-none">
                                GIF
                            </span>
                        </button>

                        {/* Media Link Input Toggle */}
                        <button
                            type="button"
                            className="text-accent-blue hover:bg-accent-blue/15 p-2 rounded-full transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Video / Media Link"
                            onClick={() => setShowMediaInput(!showMediaInput)}
                            disabled={attachments.length >= 4}
                        >
                            <Film size={19} />
                        </button>

                        {/* Poll / Topic Shortcut */}
                        <button
                            type="button"
                            className="text-accent-blue hover:bg-accent-blue/15 p-2 rounded-full transition-colors cursor-pointer"
                            title="Insert Poll / Topic"
                            onClick={() =>
                                setContent((prev) => (prev ? prev + " 📊 " : "📊 #Poll "))
                            }
                        >
                            <BarChart2 size={19} />
                        </button>

                        {/* Emoji Picker Button & Popover */}
                        <div className="relative" ref={emojiPickerRef}>
                            <button
                                type="button"
                                className={`p-2 rounded-full transition-colors cursor-pointer ${
                                    showEmojiPicker
                                        ? "bg-accent-blue/20 text-accent-blue"
                                        : "text-accent-blue hover:bg-accent-blue/15"
                                }`}
                                title="Emoji"
                                onClick={() => {
                                    setShowEmojiPicker(!showEmojiPicker);
                                    setShowGifModal(false);
                                }}
                            >
                                <Smile size={19} />
                            </button>

                            {showEmojiPicker && (
                                <div className="absolute bottom-11 left-0 z-50 shadow-2xl rounded-2xl border border-border-dark overflow-hidden bg-surface-card animate-in fade-in zoom-in-95 duration-150">
                                    <EmojiPicker
                                        theme={
                                            theme === "light"
                                                ? EmojiTheme.LIGHT
                                                : EmojiTheme.DARK
                                        }
                                        onEmojiClick={handleEmojiClick}
                                        lazyLoadEmojis={true}
                                        width={320}
                                        height={380}
                                        searchPlaceHolder="Search emoji..."
                                        previewConfig={{ showPreview: false }}
                                    />
                                </div>
                            )}
                        </div>

                        {/* OpenRouter AI Suggest Button */}
                        <button
                            type="button"
                            className="bg-gradient-to-r from-purple-500/20 to-accent-blue/20 hover:from-purple-500/35 hover:to-accent-blue/35 text-premium-violet border border-purple-500/40 rounded-full py-1 px-3 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm disabled:opacity-50 ml-1"
                            title={`Enhance with OpenRouter AI · ${aiCreditsRemaining ?? user?.entitlements?.creditsRemaining ?? "…"} credits remaining`}
                            onClick={() => {
                                setShowAiModal(true);
                                setAiPrompt(content);
                                if (content.trim()) {
                                    handleGenerateAi(content.trim(), aiAction);
                                }
                            }}
                        >
                            <Sparkles size={13} />
                            <span>AI Suggest</span>
                            <span className="rounded-full bg-black/30 px-1.5 py-0.5 text-[10px]">{aiCreditsRemaining ?? user?.entitlements?.creditsRemaining ?? "—"}</span>
                        </button>
                    </div>

                    <div className="flex items-center gap-3">
                        <span
                            className={`text-xs font-semibold ${
                                isOverLimit
                                    ? "text-red-500 font-bold"
                                    : remainingChars < 20
                                    ? "text-amber-400 font-bold"
                                    : "text-text-muted"
                            }`}
                        >
                            {countCharacters(content)} / {maxChars}
                        </span>

                        <button
                            onClick={handlePost}
                            disabled={
                                !content.trim() ||
                                isOverLimit ||
                                isPosting ||
                                hasUploading ||
                                hasError
                            }
                            className="bg-accent-blue hover:bg-accent-blue-hover text-white font-bold text-xs sm:text-sm py-1.5 sm:py-2 px-4 sm:px-5 rounded-full transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-accent-blue/25"
                        >
                            {isPosting
                                ? "Posting..."
                                : hasUploading
                                ? "Uploading..."
                                : parentTweetId
                                ? "Reply"
                                : "Post"}
                        </button>
                    </div>
                </div>
            </div>

            {/* OpenRouter AI Suggest Modal Dialog */}
            {showAiModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-surface-card border border-border-dark rounded-3xl max-w-xl w-full p-4 sm:p-6 shadow-2xl relative text-left max-h-[90vh] overflow-y-auto">
                        {/* Header */}
                        <div className="flex items-center justify-between pb-3 border-b border-border-dark">
                            <div className="flex items-center gap-2.5">
                                <div className="p-2 rounded-xl bg-purple-500/20 text-premium-violet border border-purple-500/30">
                                    <Bot size={22} />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
                                        SocialSphere AI
                                        <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-gradient-to-r from-purple-500/25 to-accent-blue/25 text-premium-violet border border-purple-500/30">
                                            {aiProvider || "OpenRouter"} · {aiModel || "openai/gpt-4o-mini"}
                                        </span>
                                    </h3>
                                    <p className="text-xs text-text-muted">
                                        {aiCreditsRemaining ?? user?.entitlements?.creditsRemaining ?? 0} AI credits remaining · OpenRouter
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowAiModal(false)}
                                className="text-text-muted hover:text-text-primary p-1.5 rounded-full hover:bg-white/10 transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Capability / Tone Selector Pills */}
                        <div className="mt-4">
                            <label className="text-xs font-semibold text-text-secondary block mb-1.5">
                                Select AI Capability or Tone
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                                {AI_CAPABILITIES.map((c) => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        disabled={!canUseAIAction(user?.entitlements?.tier, c.id) || (aiCreditsRemaining ?? user?.entitlements?.creditsRemaining ?? 0) <= 0}
                                        onClick={() => {
                                            setAiAction(c.id);
                                            handleGenerateAi(aiPrompt || content, c.id);
                                        }}
                                        title={!canUseAIAction(user?.entitlements?.tier, c.id) ? "Upgrade to Plus or Pro to use this capability" : undefined}
                                        className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                                            aiAction === c.id
                                                ? "bg-accent-blue text-white shadow-md shadow-accent-blue/25"
                                                : "bg-surface-secondary text-text-muted hover:text-text-primary hover:bg-white/10 border border-border-dark"
                                        }`}
                                    >
                                        <span>{c.icon}</span>
                                        <span>{c.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Seed Input Prompt */}
                        <div className="mt-3.5">
                            <label className="text-xs font-semibold text-text-secondary block mb-1">
                                Draft or Topic Idea
                            </label>
                            <textarea
                                value={aiPrompt}
                                onChange={(e) => setAiPrompt(e.target.value)}
                                placeholder="Type your idea, draft, or bullet points..."
                                className="w-full bg-surface-primary border border-border-dark rounded-xl p-3 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:outline-none min-h-[65px] resize-none"
                            />
                        </div>

                        {/* AI Generated Suggestion Area */}
                        <div className="mt-3.5">
                            <label className="text-xs font-semibold text-text-secondary block mb-1">
                                {aiAction === "hashtags"
                                    ? "Generated Trending Hashtags"
                                    : aiAction === "alternatives"
                                    ? "3 Distinct Post Variations"
                                    : "Generated Suggestion"}
                            </label>

                            <div className="bg-surface-primary/70 border border-border-dark rounded-xl p-3 min-h-[90px] relative flex flex-col justify-center">
                                {isAiLoading ? (
                                    <div className="flex flex-col items-center justify-center gap-2 py-6 text-text-muted text-xs">
                                        <Loader2
                                            size={24}
                                            className="animate-spin text-accent-blue"
                                        />
                                        <span>OpenRouter LLM is generating your response...</span>
                                    </div>
                                ) : aiError ? (
                                    <div className="py-3 text-center">
                                        <p className="text-red-400 text-xs mb-2">
                                            {aiError}
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => handleGenerateAi(aiPrompt || content, aiAction)}
                                            className="text-xs bg-red-500/20 text-red-300 border border-red-500/40 px-3 py-1 rounded-full hover:bg-red-500/30 font-semibold"
                                        >
                                            Try Again
                                        </button>
                                    </div>
                                ) : aiAction === "hashtags" && aiHashtags.length > 0 ? (
                                    <div className="space-y-3">
                                        <div className="flex flex-wrap gap-1.5">
                                            {aiHashtags.map((tag) => (
                                                <button
                                                    key={tag}
                                                    type="button"
                                                    onClick={() => handleAppendHashtag(tag)}
                                                    className="px-2.5 py-1 bg-surface-secondary hover:bg-accent-blue hover:text-white text-accent-blue text-xs rounded-full font-bold transition-all border border-border-dark flex items-center gap-1 cursor-pointer"
                                                    title="Click to append this hashtag to post"
                                                >
                                                    <span>{tag}</span>
                                                    <Plus size={12} />
                                                </button>
                                            ))}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleAppendAllHashtags}
                                            className="w-full py-1.5 px-3 bg-accent-blue/15 hover:bg-accent-blue/25 text-accent-blue border border-accent-blue/30 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                                        >
                                            Append All Hashtags to Tweet
                                        </button>
                                    </div>
                                ) : aiAction === "alternatives" && aiSuggestions.length > 1 ? (
                                    <div className="space-y-2">
                                        {aiSuggestions.map((item, idx) => (
                                            <div
                                                key={idx}
                                                className="p-3 bg-surface-secondary/70 border border-border-dark hover:border-accent-blue/50 rounded-xl transition-all flex flex-col justify-between gap-2"
                                            >
                                                <p className="text-xs text-text-primary whitespace-pre-wrap leading-relaxed">
                                                    {item}
                                                </p>
                                                <div className="flex items-center justify-between pt-1 border-t border-white/5">
                                                    <span className="text-[0.68rem] text-text-muted">
                                                        {countCharacters(item)} / {maxChars} chars
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleApplyAiSuggestion(item)}
                                                        className="px-3 py-1 bg-accent-blue hover:bg-accent-blue-hover text-white text-[0.72rem] font-bold rounded-full transition-all cursor-pointer flex items-center gap-1 shadow-sm"
                                                    >
                                                        <Check size={12} />
                                                        <span>Use this variation</span>
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : aiSuggestion ? (
                                    <div>
                                        <p className="text-xs text-text-primary whitespace-pre-wrap leading-relaxed">
                                            {aiSuggestion}
                                        </p>
                                        <div className="mt-2 pt-2 border-t border-border-dark/60 flex items-center justify-between text-[0.7rem] text-text-muted">
                                            <span>
                                                {countCharacters(aiSuggestion)} / {maxChars} characters
                                            </span>
                                            <span className="text-emerald-400 font-semibold">
                                                Generated by OpenRouter
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-text-muted text-xs text-center py-4">
                                        Select a capability above or click "Generate" to create a suggestion.
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Modal Footer Actions */}
                        <div className="mt-5 flex items-center justify-between gap-2 pt-3 border-t border-border-dark">
                            <button
                                type="button"
                                onClick={() => handleGenerateAi(aiPrompt || content, aiAction)}
                                disabled={isAiLoading || (!aiPrompt.trim() && !content.trim())}
                                className="px-4 py-2 rounded-full border border-border-dark text-text-primary hover:bg-white/10 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
                            >
                                <RefreshCw
                                    size={13}
                                    className={isAiLoading ? "animate-spin" : ""}
                                />
                                <span>Regenerate</span>
                            </button>

                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowAiModal(false)}
                                    className="px-4 py-2 rounded-full text-text-muted hover:text-text-primary text-xs font-medium transition-colors cursor-pointer"
                                >
                                    Cancel
                                </button>
                                {aiSuggestion && aiAction !== "alternatives" && aiAction !== "hashtags" && (
                                    <button
                                        type="button"
                                        onClick={() => handleApplyAiSuggestion()}
                                        disabled={!aiSuggestion || isAiLoading}
                                        className="px-5 py-2 rounded-full bg-accent-blue hover:bg-accent-blue-hover text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-accent-blue/25 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Check size={14} />
                                        <span>Apply to Tweet</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
