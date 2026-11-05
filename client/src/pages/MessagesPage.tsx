import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
    Send,
    Search,
    MessageSquare,
    CheckCircle,
    Loader2,
    Plus,
    X,
    AlertCircle,
    ArrowLeft,
} from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import type { Conversation, DirectMessage, User } from "../types";

export const MessagesPage: React.FC = () => {
    const { user: currentUser, loading: authLoading } = useAuth();
    const { socket } = useSocket();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();

    const selectedConvId = searchParams.get("id");

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeMessages, setActiveMessages] = useState<DirectMessage[]>([]);
    const [loadingConversations, setLoadingConversations] = useState(true);
    const [conversationsError, setConversationsError] = useState<string | null>(null);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [conversationError, setConversationError] = useState<string | null>(null);
    const [messageInput, setMessageInput] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [isOtherTyping, setIsOtherTyping] = useState(false);

    // New conversation modal
    const [showNewModal, setShowNewModal] = useState(false);
    const [userSearchQuery, setUserSearchQuery] = useState("");
    const [userSearchResults, setUserSearchResults] = useState<User[]>([]);
    const [searchingUsers, setSearchingUsers] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const typingTimeoutRef = useRef<any>(null);
    const isTypingRef = useRef(false);

    // 1. Fetch conversations with complete lifecycle and error handling
    const fetchConversations = useCallback(async () => {
        if (!currentUser) {
            setLoadingConversations(false);
            return;
        }

        setLoadingConversations(true);
        setConversationsError(null);
        try {
            const { data } = await api.get("/messages/conversations");
            setConversations(data.conversations || []);
        } catch (err: any) {
            console.error("Error fetching conversations:", err);
            const msg =
                err?.code === "ECONNABORTED"
                    ? "Request timed out while loading conversations. Please try again."
                    : err?.response?.data?.error || "Unable to load conversations. Please try again.";
            setConversationsError(msg);
        } finally {
            setLoadingConversations(false);
        }
    }, [currentUser]);

    useEffect(() => {
        if (!authLoading) {
            if (currentUser) {
                fetchConversations();
            } else {
                setLoadingConversations(false);
            }
        }
    }, [currentUser, authLoading, fetchConversations]);

    // 2. Fetch messages when active conversation changes
    const fetchMessages = useCallback(async () => {
        if (!selectedConvId) {
            setActiveMessages([]);
            setConversationError(null);
            return;
        }

        setLoadingMessages(true);
        setConversationError(null);
        try {
            const { data } = await api.get(`/messages/conversations/${selectedConvId}/messages`);
            setActiveMessages(data.messages || []);
            // Mark as read in local state
            setConversations((prev) =>
                prev.map((c) => {
                    if (c.id === selectedConvId) {
                        return {
                            ...c,
                            hasUnread: false,
                            participants: c.participants.map((p) =>
                                p.userId === currentUser?.id ? { ...p, hasReadLatest: true } : p
                            ),
                        };
                    }
                    return c;
                })
            );
        } catch (err: any) {
            console.error("Error loading messages:", err);
            const status = err?.response?.status;
            if (err?.code === "ECONNABORTED") {
                setConversationError("Request timed out while loading messages. Please try again.");
            } else if (status === 403) {
                setConversationError("You do not have authorization to view this conversation.");
            } else if (status === 404) {
                setConversationError("Conversation not found.");
            } else {
                setConversationError("Unable to load messages. Please try again.");
            }
            setActiveMessages([]);
        } finally {
            setLoadingMessages(false);
        }
    }, [selectedConvId, currentUser?.id]);

    useEffect(() => {
        fetchMessages();

        // Join socket conversation room independently of HTTP status
        if (socket && selectedConvId) {
            socket.emit("join_conversation", selectedConvId);
        }

        return () => {
            if (socket && selectedConvId) {
                socket.emit("leave_conversation", selectedConvId);
            }
            setIsOtherTyping(false);
            isTypingRef.current = false;
        };
    }, [selectedConvId, socket, fetchMessages]);

    // 3. Socket event listeners for real-time messages & typing
    useEffect(() => {
        if (!socket) return;

        const handleNewMessage = (newMsg: DirectMessage) => {
            if (newMsg.conversationId === selectedConvId) {
                // Strictly deduplicate by ID to prevent duplicate rendering
                setActiveMessages((prev) =>
                    prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg]
                );
                setTimeout(() => {
                    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                }, 100);
            }

            // Update conversation list preview
            setConversations((prev) => {
                const exists = prev.find((c) => c.id === newMsg.conversationId);
                if (exists) {
                    return prev
                        .map((c) =>
                            c.id === newMsg.conversationId
                                ? {
                                      ...c,
                                      updatedAt: newMsg.createdAt,
                                      messages: [newMsg],
                                      hasUnread: newMsg.conversationId !== selectedConvId,
                                  }
                                : c
                        )
                        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
                }
                return prev;
            });
        };

        const handleUserTyping = ({
            conversationId,
            userId,
            isTyping,
        }: {
            conversationId: string;
            userId: string;
            isTyping: boolean;
        }) => {
            if (conversationId === selectedConvId && userId !== currentUser?.id) {
                setIsOtherTyping(isTyping);
            }
        };

        socket.on("message:new", handleNewMessage);
        socket.on("user_typing", handleUserTyping);

        return () => {
            socket.off("message:new", handleNewMessage);
            socket.off("user_typing", handleUserTyping);
        };
    }, [socket, selectedConvId, currentUser?.id]);

    // 4. Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [activeMessages]);

    // 5. Handle message sending (idempotent, immediate local sync + socket deduplication)
    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!messageInput.trim() || !selectedConvId || isSending) return;

        const content = messageInput.trim();
        setMessageInput("");
        setIsSending(true);

        // Reset typing indicator immediately
        isTypingRef.current = false;
        if (socket && selectedConvId) {
            socket.emit("typing", { conversationId: selectedConvId, isTyping: false });
        }
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

        try {
            const { data } = await api.post(`/messages/conversations/${selectedConvId}/messages`, {
                content,
            });

            if (data?.message) {
                // Deduplicate and append sent message
                setActiveMessages((prev) =>
                    prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]
                );

                // Update conversation list item
                setConversations((prev) =>
                    prev.map((c) =>
                        c.id === selectedConvId
                            ? {
                                  ...c,
                                  updatedAt: data.message.createdAt,
                                  messages: [data.message],
                              }
                            : c
                    ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                );
            }
        } catch (err: any) {
            console.error("Error sending message:", err);
            setMessageInput(content); // Restore draft on error
            alert(err?.response?.data?.error || "Failed to send message. Please try again.");
        } finally {
            setIsSending(false);
        }
    };

    // 6. Handle typing with throttled leading edge + 1.5s debounce
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setMessageInput(e.target.value);

        if (!socket || !selectedConvId) return;

        // Emit typing: true only once when typing begins, not on every keystroke
        if (!isTypingRef.current) {
            isTypingRef.current = true;
            socket.emit("typing", { conversationId: selectedConvId, isTyping: true });
        }

        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            isTypingRef.current = false;
            socket.emit("typing", { conversationId: selectedConvId, isTyping: false });
        }, 1500);
    };

    // 7. Search users to start new chat
    useEffect(() => {
        if (!userSearchQuery.trim()) {
            setUserSearchResults([]);
            return;
        }

        const delay = setTimeout(async () => {
            setSearchingUsers(true);
            try {
                const { data } = await api.get(`/users/search?q=${encodeURIComponent(userSearchQuery)}`);
                setUserSearchResults(
                    (data.users || []).filter((u: User) => u.id !== currentUser?.id)
                );
            } catch (err) {
                console.error("Search error:", err);
            } finally {
                setSearchingUsers(false);
            }
        }, 250);

        return () => clearTimeout(delay);
    }, [userSearchQuery, currentUser?.id]);

    const handleStartConversation = async (recipientId: string) => {
        setShowNewModal(false);
        setUserSearchQuery("");
        setUserSearchResults([]);

        try {
            const { data } = await api.post("/messages/conversations", { recipientId });
            const conv = data.conversation;
            if (conv) {
                setConversations((prev) => {
                    if (prev.some((c) => c.id === conv.id)) return prev;
                    return [conv, ...prev];
                });
                setSearchParams({ id: conv.id });
            }
        } catch (err) {
            console.error("Error starting conversation:", err);
        }
    };

    // Helper: find other participant
    const getOtherParticipant = (conv: Conversation) => {
        const other = conv.participants?.find((p) => p.userId !== currentUser?.id);
        return other?.user;
    };

    const activeConv = conversations.find((c) => c.id === selectedConvId);
    const activeOtherUser = activeConv ? getOtherParticipant(activeConv) : null;

    return (
        <main className="center-column w-full max-w-full p-0 flex h-screen md:h-full overflow-hidden border-r border-border-dark">
            {/* Left Pane: Conversations List */}
            <div
                className={`border-r border-border-dark flex flex-col h-full bg-black flex-shrink-0 w-full md:w-[380px] ${
                    selectedConvId ? "hidden md:flex" : "flex"
                }`}
            >
                {/* Header */}
                <div className="p-4 border-b border-border-dark flex justify-between items-center bg-black/90 backdrop-blur-md">
                    <h2 className="text-xl font-extrabold text-white">Messages</h2>
                    <button
                        onClick={() => setShowNewModal(true)}
                        className="bg-accent-blue hover:bg-accent-blue-hover text-white text-xs font-bold py-2 px-4 rounded-full flex items-center gap-1.5 shadow-md shadow-accent-blue/20 transition-all cursor-pointer"
                        title="New Message"
                    >
                        <Plus size={16} />
                        <span>New Chat</span>
                    </button>
                </div>

                {/* Conversation List */}
                <div className="flex-1 overflow-y-auto divide-y divide-border-dark">
                    {loadingConversations ? (
                        <div className="p-3 flex flex-col gap-3 animate-pulse">
                            {[1, 2, 3, 4, 5].map((i) => (
                                <div key={i} className="flex items-center gap-3 p-2.5">
                                    <div className="w-11 h-11 rounded-full bg-surface-secondary flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="w-28 h-3.5 bg-surface-secondary rounded mb-2" />
                                        <div className="w-48 h-3 bg-surface-secondary/70 rounded" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : !currentUser ? (
                        <div className="py-12 px-5 text-center text-text-secondary">
                            <MessageSquare size={36} className="text-text-muted mx-auto mb-3" />
                            <h3 className="text-base font-bold text-text-primary mb-1.5">
                                Sign in to view messages
                            </h3>
                            <p className="text-xs text-text-muted mb-4 max-w-xs mx-auto">
                                Connect directly with creators on SocialSphere.
                            </p>
                            <button
                                onClick={() => navigate("/auth")}
                                className="bg-accent-blue hover:bg-accent-blue-hover text-white font-bold text-xs py-2 px-5 rounded-full shadow-md transition-all cursor-pointer"
                            >
                                Sign In
                            </button>
                        </div>
                    ) : conversationsError ? (
                        <div className="py-12 px-5 text-center text-text-secondary">
                            <AlertCircle size={36} className="text-red-500 mx-auto mb-3" />
                            <h3 className="text-base font-bold text-text-primary mb-1.5">
                                {conversationsError}
                            </h3>
                            <button
                                onClick={fetchConversations}
                                className="mt-3 bg-surface-secondary hover:bg-surface-hover border border-border-dark text-white font-bold text-xs py-2 px-4 rounded-full transition-all cursor-pointer"
                            >
                                Retry
                            </button>
                        </div>
                    ) : conversations.length === 0 ? (
                        <div className="py-12 px-5 text-center text-text-secondary">
                            <MessageSquare size={36} className="text-text-muted mx-auto mb-3" />
                            <h3 className="text-base font-bold text-text-primary mb-1">
                                No conversations yet
                            </h3>
                            <p className="text-xs text-text-muted max-w-[240px] mx-auto mb-4">
                                Choose a creator and start direct messaging.
                            </p>
                            <button
                                onClick={() => setShowNewModal(true)}
                                className="bg-accent-blue hover:bg-accent-blue-hover text-white font-bold text-xs py-2 px-4 rounded-full flex items-center gap-1.5 shadow-md mx-auto transition-all cursor-pointer"
                            >
                                <Plus size={16} />
                                <span>Start New Chat</span>
                            </button>
                        </div>
                    ) : (
                        conversations.map((conv) => {
                            const other = getOtherParticipant(conv);
                            const lastMsg = conv.messages?.[0];
                            const isSelected = conv.id === selectedConvId;
                            const myPart = conv.participants?.find((p) => p.userId === currentUser?.id);
                            const hasUnread = myPart && !myPart.hasReadLatest;

                            return (
                                <div
                                    key={conv.id}
                                    onClick={() => setSearchParams({ id: conv.id })}
                                    className={`flex items-center gap-3 p-3.5 cursor-pointer transition-colors ${
                                        isSelected ? "bg-surface-secondary" : "hover:bg-white/[0.03]"
                                    }`}
                                >
                                    <img
                                        src={
                                            other?.avatarUrl ||
                                            `https://api.dicebear.com/7.x/identicon/svg?seed=${other?.username || "guest"}`
                                        }
                                        alt={other?.username || "user"}
                                        className="w-11 h-11 rounded-full object-cover bg-surface-secondary border border-border-dark flex-shrink-0"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1">
                                            <span className="font-bold text-sm text-text-primary truncate">
                                                {other?.username || "Unknown"}
                                            </span>
                                            {other?.isVerified && (
                                                <CheckCircle size={14} className="text-accent-blue fill-accent-blue flex-shrink-0" />
                                            )}
                                        </div>
                                        <p
                                            className={`text-xs truncate mt-0.5 ${
                                                hasUnread ? "text-text-primary font-bold" : "text-text-secondary"
                                            }`}
                                        >
                                            {lastMsg?.content || "Started a conversation"}
                                        </p>
                                    </div>
                                    {hasUnread && (
                                        <div className="w-2 h-2 rounded-full bg-accent-blue flex-shrink-0" />
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Right Pane: Active Conversation Chat */}
            <div
                className={`flex flex-col h-full bg-black flex-1 min-w-0 ${
                    !selectedConvId ? "hidden md:flex" : "flex"
                }`}
            >
                {selectedConvId && activeOtherUser ? (
                    <>
                        {/* Conversation Header */}
                        <div className="px-5 py-3.5 border-b border-border-dark flex items-center gap-3 bg-black/90 backdrop-blur-md">
                            <button
                                type="button"
                                onClick={() => setSearchParams({})}
                                className="md:hidden text-text-muted hover:text-white p-1 mr-1 cursor-pointer"
                                title="Back to conversations"
                            >
                                <ArrowLeft size={20} />
                            </button>
                            <img
                                src={
                                    activeOtherUser.avatarUrl ||
                                    `https://api.dicebear.com/7.x/identicon/svg?seed=${activeOtherUser.username}`
                                }
                                alt={activeOtherUser.username}
                                className="w-10 h-10 rounded-full object-cover cursor-pointer bg-surface-secondary border border-border-dark flex-shrink-0"
                                onClick={() => navigate(`/profile/${activeOtherUser.username}`)}
                            />
                            <div>
                                <div
                                    className="flex items-center gap-1 cursor-pointer"
                                    onClick={() => navigate(`/profile/${activeOtherUser.username}`)}
                                >
                                    <span className="font-extrabold text-sm text-white hover:underline">
                                        {activeOtherUser.username}
                                    </span>
                                    {activeOtherUser.isVerified && (
                                        <CheckCircle size={14} className="text-accent-blue fill-accent-blue flex-shrink-0" />
                                    )}
                                </div>
                                <span className="text-xs text-text-muted block">
                                    @{activeOtherUser.username}
                                </span>
                            </div>
                        </div>

                        {/* Messages Stream */}
                        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-2.5">
                            {loadingMessages ? (
                                <div className="flex justify-center py-10">
                                    <Loader2 size={28} className="animate-spin text-accent-blue" />
                                </div>
                            ) : activeMessages.length === 0 ? (
                                <div className="m-auto text-center text-text-secondary text-sm">
                                    <p>Say hello to @{activeOtherUser.username}! 👋</p>
                                </div>
                            ) : (
                                activeMessages.map((msg) => {
                                    const isMe = msg.senderId === currentUser?.id;
                                    return (
                                        <div
                                            key={msg.id}
                                            className={`flex items-end gap-2 ${isMe ? "justify-end" : "justify-start"}`}
                                        >
                                            {!isMe && (
                                                <img
                                                    src={
                                                        msg.sender?.avatarUrl ||
                                                        `https://api.dicebear.com/7.x/identicon/svg?seed=${msg.sender?.username || "guest"}`
                                                    }
                                                    alt="Sender"
                                                    className="w-7 h-7 rounded-full object-cover flex-shrink-0 mb-1"
                                                />
                                            )}
                                            <div
                                                className={`max-w-[70%] px-4 py-2.5 text-sm leading-relaxed break-words shadow-sm ${
                                                    isMe
                                                        ? "bg-accent-blue text-white rounded-[18px_18px_4px_18px]"
                                                        : "bg-surface-secondary border border-border-dark text-text-primary rounded-[18px_18px_18px_4px]"
                                                }`}
                                            >
                                                {msg.content}
                                                <div
                                                    className={`text-[0.68rem] mt-1 text-right ${
                                                        isMe ? "text-white/70" : "text-text-muted"
                                                    }`}
                                                >
                                                    {new Date(msg.createdAt).toLocaleTimeString([], {
                                                        hour: "2-digit",
                                                        minute: "2-digit",
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}

                            {/* Typing indicator */}
                            {isOtherTyping && (
                                <div className="flex items-center gap-2 text-text-muted text-xs italic">
                                    <Loader2 size={13} className="animate-spin" />
                                    <span>@{activeOtherUser.username} is typing...</span>
                                </div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>

                        {/* Message Composer */}
                        <form
                            onSubmit={handleSendMessage}
                            className="p-3.5 border-t border-border-dark flex items-center gap-2.5 bg-black"
                        >
                            <input
                                type="text"
                                placeholder={`Message @${activeOtherUser.username}...`}
                                value={messageInput}
                                onChange={handleInputChange}
                                className="flex-1 bg-surface-card border border-border-dark rounded-full py-2.5 px-4 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:bg-black focus:outline-none focus:ring-1 focus:ring-accent-blue transition-all"
                            />
                            <button
                                type="submit"
                                disabled={!messageInput.trim() || isSending}
                                className="w-10 h-10 rounded-full bg-accent-blue hover:bg-accent-blue-hover text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-accent-blue/20 transition-all cursor-pointer flex-shrink-0"
                            >
                                <Send size={18} />
                            </button>
                        </form>
                    </>
                ) : conversationError ? (
                    <div className="m-auto text-center text-text-secondary p-8">
                        <AlertCircle size={48} className="text-red-500 mx-auto mb-3.5" />
                        <h3 className="text-lg font-bold text-text-primary mb-1.5">
                            Unable to Load Messages
                        </h3>
                        <p className="max-w-xs mx-auto text-xs text-text-muted mb-4">
                            {conversationError}
                        </p>
                        <div className="flex justify-center gap-2.5">
                            <button
                                onClick={fetchMessages}
                                className="bg-accent-blue hover:bg-accent-blue-hover text-white font-bold text-xs py-2 px-5 rounded-full shadow-md transition-all cursor-pointer"
                            >
                                Retry
                            </button>
                            <button
                                onClick={() => setSearchParams({})}
                                className="bg-surface-secondary hover:bg-surface-hover border border-border-dark text-white font-bold text-xs py-2 px-5 rounded-full transition-all cursor-pointer"
                            >
                                Back
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="m-auto text-center text-text-secondary p-8">
                        <MessageSquare size={48} className="text-text-muted mx-auto mb-3.5" />
                        <h3 className="text-xl font-bold text-text-primary mb-1.5">
                            Select a Message
                        </h3>
                        <p className="max-w-xs mx-auto text-xs text-text-muted mb-5">
                            Choose from your existing conversations, or start a new one with any creator.
                        </p>
                        <button
                            onClick={() => setShowNewModal(true)}
                            className="bg-accent-blue hover:bg-accent-blue-hover text-white font-bold text-xs py-2.5 px-6 rounded-full shadow-md transition-all cursor-pointer"
                        >
                            New Chat
                        </button>
                    </div>
                )}
            </div>

            {/* Modal: New Conversation Search */}
            {showNewModal && (
                <div
                    className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4"
                    onClick={() => setShowNewModal(false)}
                >
                    <div
                        className="w-full max-w-md p-6 rounded-3xl bg-surface-card border border-border-dark shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-extrabold text-white">New Message</h3>
                            <button
                                onClick={() => setShowNewModal(false)}
                                className="text-text-muted hover:text-white p-1 rounded-full cursor-pointer"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Search Input */}
                        <div className="relative mb-4">
                            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                            <input
                                type="text"
                                placeholder="Search users by name or username..."
                                value={userSearchQuery}
                                onChange={(e) => setUserSearchQuery(e.target.value)}
                                className="w-full bg-surface-input border border-border-dark rounded-full py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue focus:bg-black focus:outline-none focus:ring-1 focus:ring-accent-blue transition-all"
                                autoFocus
                            />
                        </div>

                        {/* Search Results */}
                        <div className="max-h-72 overflow-y-auto divide-y divide-border-dark">
                            {searchingUsers ? (
                                <div className="flex justify-center py-6">
                                    <Loader2 size={24} className="animate-spin text-accent-blue" />
                                </div>
                            ) : userSearchResults.length === 0 && userSearchQuery ? (
                                <p className="text-center text-text-muted py-6 text-sm">
                                    No users found
                                </p>
                            ) : (
                                userSearchResults.map((u) => (
                                    <div
                                        key={u.id}
                                        onClick={() => handleStartConversation(u.id)}
                                        className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 cursor-pointer transition-colors"
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
                                            <div className="flex items-center gap-1">
                                                <span className="font-bold text-sm text-text-primary truncate">
                                                    {u.username}
                                                </span>
                                                {u.isVerified && (
                                                    <CheckCircle size={14} className="text-accent-blue fill-accent-blue flex-shrink-0" />
                                                )}
                                            </div>
                                            <span className="text-xs text-text-muted truncate block">
                                                @{u.username}
                                            </span>
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
