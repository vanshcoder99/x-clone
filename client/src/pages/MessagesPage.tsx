import React, { useCallback, useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
    Archive, ArrowLeft, Check, CheckCheck, CheckCircle, FileText, Loader2,
    MessageCircle, MessageSquare, MoreVertical, Plus, Search, Send,
} from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../features/auth/hooks";
import { useSocket } from "../features/socket/hooks";
import type { Conversation, DirectMessage, User } from "../types";

type SidebarView = "recent" | "followers" | "following" | "requests" | "archived";
type Contact = Pick<User, "id" | "name" | "username" | "avatarUrl" | "isVerified"> & {
    conversationId: string | null;
    conversationStatus?: "ACTIVE" | "PENDING" | null;
    requestedById?: string | null;
};

const avatarFor = (username?: string | null) =>
    `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(username || "guest")}`;

const messagePreview = (message?: DirectMessage) => {
    if (!message) return "Start a conversation";
    if (message.mediaUrl) {
        const path = message.mediaUrl.split("?")[0].toLowerCase();
        if (/\.(png|jpe?g|gif|webp|avif)$/.test(path)) return "Photo";
        if (/\.(mp4|webm|mov|m4v)$/.test(path)) return "Video";
        if (/\.(mp3|wav|ogg|m4a|aac)$/.test(path)) return "Voice message";
        return "File";
    }
    return message.content || "Message";
};

const sortByRecent = (items: Conversation[]) =>
    [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

export const MessagesPage: React.FC = () => {
    const { user: currentUser, loading: authLoading } = useAuth();
    const { socket, clearUnreadDMConversation } = useSocket();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const selectedConvId = searchParams.get("id");

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [archivedConversations, setArchivedConversations] = useState<Conversation[]>([]);
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [messageRequests, setMessageRequests] = useState<Conversation[]>([]);
    const [activeView, setActiveView] = useState<SidebarView>("recent");
    const [searchQuery, setSearchQuery] = useState("");
    const [loadingConversations, setLoadingConversations] = useState(true);
    const [loadingContacts, setLoadingContacts] = useState(false);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [conversationsError, setConversationsError] = useState("");
    const [conversationError, setConversationError] = useState("");
    const [contactsError, setContactsError] = useState("");
    const [requestsError, setRequestsError] = useState("");
    const [loadingRequests, setLoadingRequests] = useState(false);
    const [activeMessages, setActiveMessages] = useState<DirectMessage[]>([]);
    const [messageInput, setMessageInput] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [isOtherTyping, setIsOtherTyping] = useState(false);
    const [busyContactId, setBusyContactId] = useState("");
    const [busyArchiveId, setBusyArchiveId] = useState("");
    const [openMenuId, setOpenMenuId] = useState("");

    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isTypingRef = useRef(false);

    const fetchConversations = useCallback(async () => {
        if (!currentUser) {
            setConversations([]);
            setArchivedConversations([]);
            setLoadingConversations(false);
            return;
        }
        setLoadingConversations(true);
        setConversationsError("");
        try {
            const recentResult = await api.get("/messages/conversations");
            setConversations(recentResult.data.conversations || []);
            try {
                const archivedResult = await api.get("/messages/conversations?archived=true");
                setArchivedConversations(archivedResult.data.conversations || []);
            } catch {
                setArchivedConversations([]);
            }
        } catch (error) {
            setConversationsError(isAxiosError(error) && typeof error.response?.data?.error === "string"
                ? error.response.data.error : "Unable to load conversations. Please try again.");
        } finally {
            setLoadingConversations(false);
        }
    }, [currentUser]);

    useEffect(() => {
        if (authLoading) return;
        const timer = window.setTimeout(() => { void fetchConversations(); }, 0);
        return () => window.clearTimeout(timer);
    }, [authLoading, fetchConversations]);

    useEffect(() => {
        if (authLoading || !currentUser || (activeView !== "followers" && activeView !== "following")) return;
        const timer = window.setTimeout(async () => {
            setLoadingContacts(true);
            setContactsError("");
            try {
                const params = new URLSearchParams({ type: activeView });
                if (searchQuery.trim()) params.set("q", searchQuery.trim());
                const { data } = await api.get(`/messages/contacts?${params.toString()}`);
                setContacts(data.contacts || []);
            } catch (error) {
                setContactsError(isAxiosError(error) && typeof error.response?.data?.error === "string"
                    ? error.response.data.error : `Unable to load ${activeView}.`);
            } finally {
                setLoadingContacts(false);
            }
        }, searchQuery.trim() ? 220 : 0);
        return () => window.clearTimeout(timer);
    }, [activeView, authLoading, currentUser, searchQuery]);

    const fetchMessageRequests = useCallback(async () => {
        if (!currentUser) {
            setMessageRequests([]);
            setLoadingRequests(false);
            return;
        }
        setLoadingRequests(true);
        setRequestsError("");
        try {
            const { data } = await api.get("/messages/requests");
            setMessageRequests(data.requests || []);
        } catch (error) {
            setRequestsError(isAxiosError(error) && typeof error.response?.data?.error === "string"
                ? error.response.data.error : "Unable to load message requests.");
        } finally {
            setLoadingRequests(false);
        }
    }, [currentUser]);

    useEffect(() => {
        if (authLoading) return;
        const timer = window.setTimeout(() => { void fetchMessageRequests(); }, 0);
        return () => window.clearTimeout(timer);
    }, [activeView, authLoading, currentUser, fetchMessageRequests]);

    const fetchMessages = useCallback(async () => {
        if (!selectedConvId) {
            setActiveMessages([]);
            setConversationError("");
            return;
        }
        setLoadingMessages(true);
        setConversationError("");
        try {
            const { data } = await api.get(`/messages/conversations/${selectedConvId}/messages`);
            setActiveMessages(data.messages || []);
            clearUnreadDMConversation(selectedConvId);
            const readAt = new Date().toISOString();
            const markRead = (list: Conversation[]) => list.map((item) => item.id !== selectedConvId ? item : {
                ...item,
                unreadCount: 0,
                hasUnread: false,
                participants: item.participants.map((participant) => participant.userId === currentUser?.id
                    ? { ...participant, hasReadLatest: true, lastReadAt: readAt } : participant),
            });
            setConversations(markRead);
            setArchivedConversations(markRead);
        } catch (error) {
            const status = isAxiosError(error) ? error.response?.status : undefined;
            setConversationError(status === 403
                ? (isAxiosError(error) && typeof error.response?.data?.error === "string" ? error.response.data.error : "You can’t access this conversation.")
                : status === 404 ? "Conversation not found." : "Unable to load messages. Please try again.");
            setActiveMessages([]);
        } finally {
            setLoadingMessages(false);
        }
    }, [selectedConvId, currentUser?.id, clearUnreadDMConversation]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void fetchMessages();
            setMessageInput("");
            if (socket && selectedConvId) socket.emit("join_conversation", selectedConvId);
        }, 0);
        return () => {
            window.clearTimeout(timer);
            if (socket && selectedConvId) socket.emit("leave_conversation", selectedConvId);
            setIsOtherTyping(false);
            isTypingRef.current = false;
        };
    }, [selectedConvId, socket, fetchMessages]);

    useEffect(() => {
        if (!socket) return;
        const handleNewMessage = (message: DirectMessage) => {
            if (message.conversationId === selectedConvId) {
                setActiveMessages((previous) => previous.some((item) => item.id === message.id) ? previous : [...previous, message]);
                if (message.senderId !== currentUser?.id) {
                    void api.patch(`/messages/conversations/${message.conversationId}/read`).catch(() => undefined);
                }
            }
            const applyMessage = (list: Conversation[]) => sortByRecent(list.map((item) => {
                if (item.id !== message.conversationId) return item;
                const viewing = message.conversationId === selectedConvId;
                const unreadCount = message.senderId !== currentUser?.id && !viewing ? (item.unreadCount || 0) + 1 : viewing ? 0 : item.unreadCount || 0;
                return {
                    ...item,
                    updatedAt: message.createdAt,
                    messages: [message],
                    unreadCount,
                    hasUnread: unreadCount > 0,
                    participants: item.participants.map((participant) => participant.userId === currentUser?.id && viewing
                        ? { ...participant, hasReadLatest: true, lastReadAt: new Date().toISOString() }
                        : participant.userId !== currentUser?.id && message.senderId === currentUser?.id
                            ? { ...participant, hasReadLatest: false } : participant),
                };
            }));
            setConversations(applyMessage);
            setArchivedConversations(applyMessage);
        };
        const handleTyping = (data: { conversationId: string; userId: string; isTyping: boolean }) => {
            if (data.conversationId === selectedConvId && data.userId !== currentUser?.id) setIsOtherTyping(data.isTyping);
        };
        const handleRead = (data: { conversationId: string; readerUserId: string; readAt: string }) => {
            if (data.readerUserId === currentUser?.id) return;
            const markRead = (items: Conversation[]) => items.map((item) => item.id !== data.conversationId ? item : {
                ...item,
                participants: item.participants.map((participant) => participant.userId === data.readerUserId
                    ? { ...participant, hasReadLatest: true, lastReadAt: data.readAt } : participant),
            });
            setConversations(markRead);
            setArchivedConversations(markRead);
        };
        const handleRequest = () => { void fetchMessageRequests(); };
        const handleRequestAccepted = ({ conversationId }: { conversationId: string }) => {
            setConversations((items) => items.map((item) => item.id === conversationId ? { ...item, status: "ACTIVE", requestedById: null } : item));
            void fetchConversations();
        };
        const handleRequestDeleted = ({ conversationId }: { conversationId: string }) => {
            setConversations((items) => items.filter((item) => item.id !== conversationId));
            setMessageRequests((items) => items.filter((item) => item.id !== conversationId));
            if (selectedConvId === conversationId) setSearchParams({});
        };
        socket.on("message:new", handleNewMessage);
        socket.on("user_typing", handleTyping);
        socket.on("conversation:read", handleRead);
        socket.on("message:request:new", handleRequest);
        socket.on("message:request:accepted", handleRequestAccepted);
        socket.on("message:request:deleted", handleRequestDeleted);
        return () => {
            socket.off("message:new", handleNewMessage);
            socket.off("user_typing", handleTyping);
            socket.off("conversation:read", handleRead);
            socket.off("message:request:new", handleRequest);
            socket.off("message:request:accepted", handleRequestAccepted);
            socket.off("message:request:deleted", handleRequestDeleted);
        };
    }, [socket, selectedConvId, currentUser?.id, fetchConversations, fetchMessageRequests, setSearchParams]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [activeMessages]);

    const handleSendMessage = async (event: React.FormEvent | React.KeyboardEvent) => {
        event.preventDefault();
        if (!messageInput.trim() || !selectedConvId || isSending) return;
        const content = messageInput.trim();
        setIsSending(true);
        isTypingRef.current = false;
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        socket?.emit("typing", { conversationId: selectedConvId, isTyping: false });
        setConversationError("");
        try {
            const { data } = await api.post(`/messages/conversations/${selectedConvId}/messages`, { content });
            const message: DirectMessage = data.message;
            setActiveMessages((previous) => previous.some((item) => item.id === message.id) ? previous : [...previous, message]);
            setMessageInput((draft) => draft === content ? "" : draft);
            const updatePreview = (list: Conversation[]) => sortByRecent(list.map((item) => item.id === selectedConvId
                ? { ...item, updatedAt: message.createdAt, messages: [message], participants: item.participants.map((participant) => participant.userId === currentUser?.id ? participant : { ...participant, hasReadLatest: false }) }
                : item));
            setConversations(updatePreview);
            setArchivedConversations(updatePreview);
        } catch (error) {
            setConversationError(isAxiosError(error) && typeof error.response?.data?.error === "string"
                ? error.response.data.error : "Message could not be sent. Your draft is still here; please try again.");
        } finally {
            setIsSending(false);
        }
    };

    const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setMessageInput(event.target.value);
        if (!socket || !selectedConvId) return;
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

    const openContact = async (contact: Contact) => {
        if (busyContactId) return;
        setBusyContactId(contact.id);
        setContactsError("");
        try {
            const { data } = await api.post("/messages/conversations", { recipientId: contact.id });
            let conversation: Conversation = data.conversation;
            const myParticipant = conversation.participants?.find((participant) => participant.userId === currentUser?.id);
            if (myParticipant?.archivedAt) {
                await api.patch(`/messages/conversations/${conversation.id}/archive`, { archived: false });
                setArchivedConversations((items) => items.filter((item) => item.id !== conversation.id));
                conversation = { ...conversation, participants: conversation.participants.map((participant) => participant.userId === currentUser?.id ? { ...participant, archivedAt: null } : participant) };
            }
            const receivedRequest = conversation.status === "PENDING" && conversation.requestedById !== currentUser?.id;
            if (receivedRequest) setMessageRequests((items) => [conversation, ...items.filter((item) => item.id !== conversation.id)]);
            else setConversations((items) => sortByRecent([conversation, ...items.filter((item) => item.id !== conversation.id)]));
            setActiveView(receivedRequest ? "requests" : "recent");
            setSearchParams({ id: conversation.id });
            void fetchConversations();
            if (receivedRequest) void fetchMessageRequests();
        } catch (error) {
            setContactsError(isAxiosError(error) && typeof error.response?.data?.error === "string"
                ? error.response.data.error : "Could not open this chat. Confirm neither account has blocked the other.");
        } finally {
            setBusyContactId("");
        }
    };

    const respondToRequest = async (conversation: Conversation, accept: boolean) => {
        setConversationError("");
        try {
            const { data } = await api.patch(`/messages/conversations/${conversation.id}/request`, { accept });
            setMessageRequests((items) => items.filter((item) => item.id !== conversation.id));
            if (accept && data.conversation) {
                const acceptedConversation: Conversation = { ...conversation, ...data.conversation, status: "ACTIVE", requestedById: null };
                setConversations((items) => sortByRecent([acceptedConversation, ...items.filter((item) => item.id !== conversation.id)]));
                setActiveView("recent");
                void fetchConversations();
            } else {
                setSearchParams({});
                setActiveMessages([]);
            }
        } catch (error) {
            setConversationError(isAxiosError(error) && typeof error.response?.data?.error === "string"
                ? error.response.data.error : "Could not update this message request.");
        }
    };

    const setConversationArchived = async (conversation: Conversation, archived: boolean) => {
        setBusyArchiveId(conversation.id);
        setOpenMenuId("");
        try {
            await api.patch(`/messages/conversations/${conversation.id}/archive`, { archived });
            const updatedConversation = {
                ...conversation,
                participants: conversation.participants.map((participant) => participant.userId === currentUser?.id
                    ? { ...participant, archivedAt: archived ? new Date().toISOString() : null } : participant),
            };
            if (archived) {
                setConversations((items) => items.filter((item) => item.id !== conversation.id));
                setArchivedConversations((items) => sortByRecent([updatedConversation, ...items.filter((item) => item.id !== conversation.id)]));
            } else {
                setArchivedConversations((items) => items.filter((item) => item.id !== conversation.id));
                setConversations((items) => sortByRecent([updatedConversation, ...items.filter((item) => item.id !== conversation.id)]));
                setActiveView("recent");
            }
        } catch (error) {
            setConversationError(isAxiosError(error) && typeof error.response?.data?.error === "string"
                ? error.response.data.error : "Could not update this conversation.");
        } finally {
            setBusyArchiveId("");
        }
    };

    const getOtherUser = (conversation: Conversation) => conversation.otherUser
        || conversation.participants?.find((participant) => participant.userId !== currentUser?.id)?.user;
    const activeConversation = [...conversations, ...archivedConversations, ...messageRequests].find((conversation) => conversation.id === selectedConvId);
    const activeUser = activeConversation ? getOtherUser(activeConversation) : null;
    const isIncomingMessageRequest = activeConversation?.status === "PENDING" && activeConversation.requestedById !== currentUser?.id;
    const isOutgoingMessageRequest = activeConversation?.status === "PENDING" && activeConversation.requestedById === currentUser?.id;
    const viewItems = activeView === "archived" ? archivedConversations : conversations;
    const query = searchQuery.trim().toLowerCase();
    const filteredConversations = viewItems.filter((conversation) => {
        const other = getOtherUser(conversation);
        const latest = messagePreview(conversation.messages?.[0]);
        return !query || `${other?.name || ""} ${other?.username || ""} ${latest}`.toLowerCase().includes(query);
    });

    return (
        <main className="messages-workspace flex h-[calc(100dvh-58px)] min-h-0 w-full min-w-0 flex-1 overflow-hidden border-r border-border-dark bg-surface-primary md:h-full">
            <aside className={`flex h-full w-full min-h-0 flex-col border-r border-border-dark bg-surface-primary md:w-[350px] md:min-w-[320px] md:max-w-[360px] ${selectedConvId ? "hidden md:flex" : "flex"}`}>
                <header className="flex items-center justify-between gap-3 border-b border-border-dark px-4 py-4">
                    <h1 className="text-2xl font-extrabold text-text-primary">{activeView === "archived" ? "Archived" : "Chats"}</h1>
                    <div className="flex items-center gap-1">
                        <button type="button" onClick={() => { setActiveView("following"); setSearchQuery(""); }} className="rounded-full p-2 text-text-secondary transition hover:bg-white/5 hover:text-text-primary" title="New chat" aria-label="New chat"><Plus size={20} /></button>
                        <div className="relative">
                            <button type="button" onClick={() => setOpenMenuId(openMenuId === "sidebar" ? "" : "sidebar")} className="rounded-full p-2 text-text-secondary transition hover:bg-white/5 hover:text-text-primary" title="More options" aria-label="More options"><MoreVertical size={20} /></button>
                            {openMenuId === "sidebar" && <div className="absolute right-0 top-11 z-20 w-44 rounded-xl border border-border-dark bg-surface-card p-1 shadow-xl">
                                <button type="button" onClick={() => { setActiveView(activeView === "archived" ? "recent" : "archived"); setSearchQuery(""); setOpenMenuId(""); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-text-primary hover:bg-white/5"><Archive size={16} />{activeView === "archived" ? "Back to recent" : `Archived (${archivedConversations.length})`}</button>
                            </div>}
                        </div>
                    </div>
                </header>

                <label className="relative block px-3 py-3">
                    <Search size={17} className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-text-muted" />
                    <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search or start new chat" className="w-full rounded-xl border border-border-dark bg-surface-secondary py-2.5 pl-10 pr-3 text-sm text-text-primary placeholder:text-text-muted outline-none transition focus:border-accent-blue" />
                </label>

                <label className="block border-b border-border-dark px-3 pb-3">
                    <span className="sr-only">Message list</span>
                    <select value={activeView} onChange={(event) => { setActiveView(event.target.value as SidebarView); setSearchQuery(""); setOpenMenuId(""); }} className="w-full rounded-xl border border-border-dark bg-surface-secondary px-3 py-2.5 text-sm font-semibold text-text-primary outline-none focus:border-accent-blue">
                        <option value="recent">Recents</option>
                        <option value="followers">Followers</option>
                        <option value="following">Following</option>
                        <option value="requests">Requests{messageRequests.length ? ` (${messageRequests.length})` : ""}</option>
                        {activeView === "archived" && <option value="archived">Archived</option>}
                    </select>
                </label>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    {activeView === "followers" || activeView === "following" ? (
                        !currentUser ? <div className="p-6 text-center"><p className="mb-4 text-sm text-text-secondary">Sign in to view your {activeView}.</p><button type="button" onClick={() => navigate("/auth")} className="rounded-full bg-accent-blue px-4 py-2 text-sm font-bold text-white">Sign in</button></div>
                            : loadingContacts ? <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin text-accent-blue" /></div>
                                : contactsError ? <div className="p-5 text-center text-sm text-red-500">{contactsError}</div>
                                    : contacts.length === 0 ? <div className="px-6 py-12 text-center"><MessageCircle size={32} className="mx-auto mb-3 text-text-muted" /><h2 className="font-bold text-text-primary">No {activeView} yet</h2><p className="mt-2 text-sm leading-5 text-text-secondary">People in your {activeView} list will appear here. If the recipient doesn’t follow you, your first message goes to their Requests.</p></div>
                                        : contacts.map((contact) => <button key={contact.id} type="button" onClick={() => void openContact(contact)} disabled={Boolean(busyContactId)} className="flex w-full items-center gap-3 border-b border-border-dark px-4 py-3 text-left transition hover:bg-white/5 disabled:opacity-60">
                                            <img src={contact.avatarUrl || avatarFor(contact.username)} alt="" className="h-12 w-12 shrink-0 rounded-full border border-border-dark bg-surface-secondary object-cover" />
                                            <span className="min-w-0 flex-1"><span className="flex items-center gap-1 truncate font-bold text-text-primary">{contact.name || contact.username}{contact.isVerified && <CheckCircle size={14} className="shrink-0 fill-accent-blue text-accent-blue" />}</span><span className="mt-0.5 block truncate text-sm text-text-secondary">@{contact.username}</span><span className="mt-1 block text-xs text-text-muted">{contact.conversationStatus === "PENDING" && contact.requestedById === currentUser?.id ? "Message request sent" : contact.conversationId ? "Open conversation" : "Start a chat"}</span></span>
                                            {busyContactId === contact.id ? <Loader2 size={18} className="animate-spin text-accent-blue" /> : <MessageCircle size={18} className="text-accent-blue" />}
                                        </button>)
                    ) : activeView === "requests" ? loadingRequests ? <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin text-accent-blue" /></div>
                        : requestsError ? <div className="p-5 text-center text-sm text-red-500">{requestsError}<button type="button" onClick={() => void fetchMessageRequests()} className="mt-3 block w-full text-accent-blue">Retry</button></div>
                            : messageRequests.length === 0 ? <div className="px-6 py-12 text-center"><MessageCircle size={32} className="mx-auto mb-3 text-text-muted" /><h2 className="font-bold text-text-primary">No message requests</h2><p className="mt-2 text-sm leading-5 text-text-secondary">Messages from people you don’t follow back will appear here.</p></div>
                                : messageRequests.filter((conversation) => {
                                    const other = getOtherUser(conversation);
                                    return !query || `${other?.name || ""} ${other?.username || ""} ${messagePreview(conversation.messages?.[0])}`.toLowerCase().includes(query);
                                }).map((conversation) => {
                                    const other = getOtherUser(conversation);
                                    if (!other) return null;
                                    return <button key={conversation.id} type="button" onClick={() => setSearchParams({ id: conversation.id })} className={`flex w-full items-center gap-3 border-b border-border-dark px-3 py-3 text-left transition hover:bg-white/5 ${conversation.id === selectedConvId ? "bg-accent-blue/10" : ""}`}>
                                        <img src={other.avatarUrl || avatarFor(other.username)} alt="" className="h-12 w-12 shrink-0 rounded-full border border-border-dark bg-surface-secondary object-cover" />
                                        <span className="min-w-0 flex-1"><span className="block truncate font-bold text-text-primary">{other.name || other.username}</span><span className="mt-0.5 block truncate text-sm text-text-secondary">@{other.username}</span><span className="mt-1 block truncate text-xs text-text-muted">{messagePreview(conversation.messages?.[0])}</span></span>
                                    </button>;
                                })
                    : loadingConversations ? <div className="space-y-3 p-3" aria-label="Loading conversations" aria-busy="true">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="flex animate-pulse items-center gap-3 p-2"><div className="h-12 w-12 rounded-full bg-[var(--bg-card-hover)]" /><div className="flex-1"><div className="mb-2 h-3 w-28 rounded bg-[var(--bg-card-hover)]" /><div className="h-3 w-40 rounded bg-[var(--bg-card-hover)] opacity-70" /></div></div>)}</div>
                        : conversationsError ? <div className="p-5 text-center text-sm text-red-500">{conversationsError}<button type="button" onClick={() => void fetchConversations()} className="mt-3 block w-full text-accent-blue">Retry</button></div>
                            : filteredConversations.length === 0 ? <div className="px-6 py-12 text-center text-sm text-text-secondary">{query ? "No chats match your search." : activeView === "archived" ? "No archived chats." : "No recent conversations yet. Choose Followers or Following to start a chat."}</div>
                                : filteredConversations.map((conversation) => {
                                    const other = getOtherUser(conversation);
                                    const lastMessage = conversation.messages?.[0];
                                    const unread = conversation.unreadCount || 0;
                                    const selected = conversation.id === selectedConvId;
                                    return <div key={conversation.id} className={`group relative flex items-center gap-3 border-b border-border-dark px-3 py-3 transition ${selected ? "bg-accent-blue/10" : "hover:bg-white/5"}`}>
                                        <button type="button" onClick={() => { setActiveView(activeView === "archived" ? "archived" : "recent"); setSearchParams({ id: conversation.id }); }} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                                            <img src={other?.avatarUrl || avatarFor(other?.username)} alt="" className="h-12 w-12 shrink-0 rounded-full border border-border-dark bg-surface-secondary object-cover" />
                                            <span className="min-w-0 flex-1"><span className="flex items-center gap-1 truncate font-bold text-text-primary">{other?.name || other?.username || "SocialSphere user"}{other?.isVerified && <CheckCircle size={14} className="shrink-0 fill-accent-blue text-accent-blue" />}</span><span className="mt-0.5 block truncate text-[11px] text-text-muted">@{other?.username}</span><span className={`mt-1 block truncate text-sm ${unread ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{lastMessage?.senderId === currentUser?.id ? "You: " : ""}{messagePreview(lastMessage)}</span></span>
                                            <span className="flex shrink-0 flex-col items-end gap-1 self-stretch pt-1"><span className="text-[11px] text-text-muted">{lastMessage ? new Date(lastMessage.createdAt).toDateString() === new Date().toDateString() ? new Date(lastMessage.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : new Date(lastMessage.createdAt).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}</span>{unread > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-blue px-1 text-[10px] font-bold text-white">{unread}</span>}</span>
                                        </button>
                                        <button type="button" onClick={() => setOpenMenuId(openMenuId === conversation.id ? "" : conversation.id)} aria-label="Conversation options" className="rounded-full p-1.5 text-text-muted opacity-100 transition hover:bg-white/5 hover:text-text-primary md:opacity-0 md:group-hover:opacity-100"><MoreVertical size={17} /></button>
                                        {openMenuId === conversation.id && <div className="absolute right-2 top-12 z-20 rounded-xl border border-border-dark bg-surface-card p-1 shadow-xl"><button type="button" onClick={() => void setConversationArchived(conversation, activeView !== "archived")} disabled={busyArchiveId === conversation.id} className="flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-text-primary hover:bg-white/5"><Archive size={15} />{activeView === "archived" ? "Unarchive" : "Archive"}</button></div>}
                                    </div>;
                                })}
                </div>
            </aside>

            <section className={`flex min-h-0 min-w-0 flex-1 flex-col bg-surface-primary ${selectedConvId ? "flex" : "hidden md:flex"}`}>
                {selectedConvId && activeUser && !conversationError ? <>
                    <header className="flex items-center gap-3 border-b border-border-dark bg-surface-primary px-3 py-3 sm:px-5">
                        <button type="button" onClick={() => setSearchParams({})} aria-label="Back to chats" className="rounded-full p-2 text-text-secondary hover:bg-white/5 md:hidden"><ArrowLeft size={20} /></button>
                        <button type="button" onClick={() => navigate(`/profile/${activeUser.username}`)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                            <img src={activeUser.avatarUrl || avatarFor(activeUser.username)} alt="" className="h-10 w-10 shrink-0 rounded-full border border-border-dark bg-surface-secondary object-cover" />
                            <span className="min-w-0"><span className="flex items-center gap-1 truncate font-bold text-text-primary">{activeUser.name || activeUser.username}{activeUser.isVerified && <CheckCircle size={14} className="shrink-0 fill-accent-blue text-accent-blue" />}</span><span className="block truncate text-xs text-text-secondary">@{activeUser.username}</span></span>
                        </button>
                        <div className="relative"><button type="button" onClick={() => setOpenMenuId(openMenuId === "active" ? "" : "active")} aria-label="Chat options" className="rounded-full p-2 text-text-secondary hover:bg-white/5"><MoreVertical size={20} /></button>
                            {openMenuId === "active" && <div className="absolute right-0 top-11 z-20 w-40 rounded-xl border border-border-dark bg-surface-card p-1 shadow-xl"><button type="button" onClick={() => activeConversation && void setConversationArchived(activeConversation, !activeConversation.participants.find((participant) => participant.userId === currentUser?.id)?.archivedAt)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-text-primary hover:bg-white/5"><Archive size={15} />{activeConversation?.participants.find((participant) => participant.userId === currentUser?.id)?.archivedAt ? "Unarchive chat" : "Archive chat"}</button></div>}
                        </div>
                    </header>

                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-surface-primary p-4 sm:p-6">
                        {loadingMessages ? <div className="flex flex-1 items-center justify-center"><Loader2 size={26} className="animate-spin text-accent-blue" /></div>
                            : activeMessages.length === 0 ? <div className="m-auto rounded-2xl border border-border-dark bg-surface-card px-5 py-3 text-center text-sm text-text-secondary">Say hello to @{activeUser.username} 👋</div>
                                : activeMessages.map((message, index) => {
                                    const mine = message.senderId === currentUser?.id;
                                    const previous = activeMessages[index - 1];
                                    const next = activeMessages[index + 1];
                                    const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
                                    const grouped = Boolean(previous && previous.senderId === message.senderId && new Date(previous.createdAt).toDateString() === new Date(message.createdAt).toDateString());
                                    const lastInGroup = !next || next.senderId !== message.senderId || new Date(next.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
                                    const mediaPath = message.mediaUrl?.split("?")[0].toLowerCase() || "";
                                    const isImage = /\.(png|jpe?g|gif|webp|avif)$/.test(mediaPath);
                                    const isVideo = /\.(mp4|webm|mov|m4v)$/.test(mediaPath);
                                    const isAudio = /\.(mp3|wav|ogg|m4a|aac)$/.test(mediaPath);
                                    const participantRead = activeConversation?.participants.find((participant) => participant.userId !== currentUser?.id)?.hasReadLatest;
                                    return <React.Fragment key={message.id}>
                                        {newDay && <div className="my-3 self-center rounded-full border border-border-dark bg-surface-card px-3 py-1 text-[11px] text-text-secondary">{new Date(message.createdAt).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}</div>}
                                        <div className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                                            {!mine && lastInGroup ? <img src={message.sender?.avatarUrl || avatarFor(message.sender?.username)} alt="" className="mb-1 h-7 w-7 rounded-full object-cover" /> : !mine ? <span className="w-7 shrink-0" /> : null}
                                            <div className={`max-w-[min(78%,720px)] break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${mine ? "rounded-br-sm bg-accent-blue text-white" : "rounded-bl-sm border border-border-dark bg-surface-secondary text-text-primary"} ${grouped ? (mine ? "rounded-tr-md" : "rounded-tl-md") : ""}`}>
                                                {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
                                                {message.mediaUrl && (isImage ? <a href={message.mediaUrl} target="_blank" rel="noreferrer"><img src={message.mediaUrl} alt="Shared photo" loading="lazy" className="mt-2 max-h-72 max-w-full rounded-xl object-contain" /></a>
                                                    : isVideo ? <video src={message.mediaUrl} controls className="mt-2 max-h-72 max-w-full rounded-xl" />
                                                        : isAudio ? <audio src={message.mediaUrl} controls className="mt-2 max-w-full" />
                                                            : <a href={message.mediaUrl} target="_blank" rel="noreferrer" className={`mt-2 flex items-center gap-2 rounded-lg p-2 underline ${mine ? "bg-black/10" : "bg-black/5"}`}><FileText size={17} />File</a>)}
                                                <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${mine ? "text-white/75" : "text-text-muted"}`}><span>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>{mine && (participantRead ? <CheckCheck size={14} aria-label="Read" /> : <Check size={13} aria-label="Sent" />)}</div>
                                            </div>
                                        </div>
                                    </React.Fragment>;
                                })}
                        {isOtherTyping && <div className="ml-9 text-xs italic text-text-muted">@{activeUser.username} is typing…</div>}
                        <div ref={messagesEndRef} />
                    </div>

                    {conversationError && <p role="alert" className="px-4 py-2 text-sm text-red-500">{conversationError}</p>}
                    {isIncomingMessageRequest ? <div className="border-t border-border-dark bg-surface-primary p-4 sm:px-5">
                        <p className="mb-3 text-sm text-text-secondary">This is a message request. Accept it to reply and move this chat to Recents.</p>
                        <div className="flex gap-2"><button type="button" onClick={() => activeConversation && void respondToRequest(activeConversation, true)} className="rounded-full bg-accent-blue px-5 py-2 text-sm font-bold text-white hover:bg-accent-blue-hover">Accept</button><button type="button" onClick={() => activeConversation && void respondToRequest(activeConversation, false)} className="rounded-full border border-border-dark px-5 py-2 text-sm font-semibold text-text-primary hover:bg-white/5">Delete</button></div>
                    </div> : <>
                    {isOutgoingMessageRequest && <p className="border-t border-border-dark px-4 py-2 text-xs text-text-secondary">Message request sent. The recipient can accept it before the chat moves to Recents.</p>}
                    <form onSubmit={(event) => void handleSendMessage(event)} className="flex items-end gap-2 border-t border-border-dark bg-surface-primary p-3 sm:px-5 sm:py-4">
                        <textarea rows={1} value={messageInput} onChange={handleInputChange} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) void handleSendMessage(event); }} placeholder={`Message @${activeUser.username}`} disabled={isSending} className="max-h-36 min-h-11 flex-1 resize-y rounded-2xl border border-border-dark bg-surface-secondary px-4 py-3 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue disabled:opacity-70" />
                        <button type="submit" disabled={!messageInput.trim() || isSending} aria-label="Send message" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-blue text-white shadow-md shadow-accent-blue/20 transition hover:bg-accent-blue-hover disabled:cursor-not-allowed disabled:opacity-40">{isSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}</button>
                    </form></>}
                </> : conversationError ? <div className="m-auto max-w-sm p-8 text-center"><MessageSquare size={36} className="mx-auto mb-3 text-text-muted" /><h2 className="font-bold text-text-primary">Chat unavailable</h2><p className="mt-2 text-sm text-text-secondary">{conversationError}</p><button type="button" onClick={() => void fetchMessages()} className="mt-4 rounded-full bg-accent-blue px-4 py-2 text-sm font-bold text-white">Retry</button></div>
                    : <div className="m-auto max-w-sm p-8 text-center"><div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent-blue/10 text-accent-blue"><MessageSquare size={30} /></div><h2 className="text-xl font-bold text-text-primary">Your private messages</h2><p className="mt-2 text-sm leading-6 text-text-secondary">Choose a recent conversation or find someone in Followers or Following to start chatting.</p><button type="button" onClick={() => { setActiveView("following"); setSearchQuery(""); }} className="mt-5 inline-flex items-center gap-2 rounded-full bg-accent-blue px-5 py-2.5 text-sm font-bold text-white hover:bg-accent-blue-hover"><Plus size={16} />New chat</button></div>}
            </section>
        </main>
    );
};
