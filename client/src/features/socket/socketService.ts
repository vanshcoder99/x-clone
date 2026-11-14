import { io, type Socket } from "socket.io-client";
import { api, getAccessToken } from "../../api/client";
import type { AppDispatch } from "../../store/store";
import type { NotificationItem, Tweet } from "../../types";
import {
    clearUnreadDMConversation, markDMConversationUnread, setLatestNotification, setLatestTweet, setUnreadDMConversations,
    socketConnected, socketCreated, socketDisconnected,
} from "./socketSlice";

let activeSocket: Socket | null = null;

export const getSocket = () => activeSocket;

export const connectSocket = (userId: string, dispatch: AppDispatch) => {
    let active = true;
    dispatch(setUnreadDMConversations({}));
    void api.get("/messages/conversations").then(({ data }) => {
        if (!active) return;
        const unread = Object.fromEntries((data.conversations || [])
            .filter((conversation: { unreadCount?: number }) => (conversation.unreadCount || 0) > 0)
            .map((conversation: { id: string; unreadCount: number }) => [conversation.id, conversation.unreadCount]));
        dispatch(setUnreadDMConversations(unread));
    }).catch(() => undefined);

    const socketUrl = import.meta.env.VITE_SOCKET_URL || (import.meta.env.VITE_API_URL
        ? import.meta.env.VITE_API_URL.trim().replace(/\/api\/?$/, "").replace(/\/$/, "")
        : "http://localhost:5000");
    const token = getAccessToken();
    const socket = io(socketUrl, {
        withCredentials: true,
        auth: { token: token || undefined },
        autoConnect: true,
        transports: ["websocket", "polling"],
    });
    activeSocket = socket;
    dispatch(socketCreated());

    socket.on("connect", () => {
        dispatch(socketConnected());
        const currentToken = getAccessToken();
        if (currentToken) socket.emit("authenticate", currentToken);
    });
    socket.on("disconnect", () => dispatch(socketDisconnected()));
    socket.on("notification:new", (notification: NotificationItem) => dispatch(setLatestNotification(notification)));
    socket.on("tweet:new", (tweet: Tweet) => {
        if (tweet.author.id !== userId) dispatch(setLatestTweet(tweet));
    });
    socket.on("message:unread", ({ conversationId }: { conversationId?: string }) => {
        if (conversationId) dispatch(markDMConversationUnread(conversationId));
    });
    socket.on("conversation:read", ({ conversationId, readerUserId }: { conversationId?: string; readerUserId?: string }) => {
        if (conversationId && readerUserId === userId) {
            dispatch(clearUnreadDMConversation(conversationId));
        }
    });

    return () => {
        active = false;
        if (activeSocket === socket) activeSocket = null;
        socket.disconnect();
        dispatch(socketDisconnected());
    };
};
