import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { NotificationItem, Tweet } from "../../types";

export interface SocketState {
    isConnected: boolean;
    revision: number;
    latestNotification: NotificationItem | null;
    latestTweet: Tweet | null;
    unreadDMConversations: Record<string, number>;
}

const initialState: SocketState = {
    isConnected: false,
    revision: 0,
    latestNotification: null,
    latestTweet: null,
    unreadDMConversations: {},
};

const socketSlice = createSlice({
    name: "socket",
    initialState,
    reducers: {
        socketCreated(state) { state.revision += 1; },
        socketConnected(state) { state.isConnected = true; },
        socketDisconnected(state) { state.isConnected = false; },
        setLatestNotification(state, action: PayloadAction<NotificationItem>) { state.latestNotification = action.payload; },
        clearLatestNotification(state) { state.latestNotification = null; },
        setLatestTweet(state, action: PayloadAction<Tweet>) { state.latestTweet = action.payload; },
        clearLatestTweet(state) { state.latestTweet = null; },
        setUnreadDMConversations(state, action: PayloadAction<Record<string, number>>) { state.unreadDMConversations = action.payload; },
        markDMConversationUnread(state, action: PayloadAction<string>) {
            if (!state.unreadDMConversations[action.payload]) state.unreadDMConversations[action.payload] = 1;
        },
        clearUnreadDMConversation(state, action: PayloadAction<string>) { delete state.unreadDMConversations[action.payload]; },
        decrementUnreadDMs(state) {
            const firstUnread = Object.keys(state.unreadDMConversations)[0];
            if (firstUnread) delete state.unreadDMConversations[firstUnread];
        },
        resetSocketState() { return initialState; },
    },
});

export const {
    socketCreated, socketConnected, socketDisconnected, setLatestNotification, clearLatestNotification,
    setLatestTweet, clearLatestTweet, setUnreadDMConversations, markDMConversationUnread,
    clearUnreadDMConversation, decrementUnreadDMs, resetSocketState,
} = socketSlice.actions;
export default socketSlice.reducer;
