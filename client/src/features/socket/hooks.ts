import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { getSocket } from "./socketService";
import {
    clearLatestNotification, clearLatestTweet, clearUnreadDMConversation, decrementUnreadDMs,
} from "./socketSlice";

export const useSocket = () => {
    const dispatch = useAppDispatch();
    const isConnected = useAppSelector((state) => state.socket.isConnected);
    const latestNotification = useAppSelector((state) => state.socket.latestNotification);
    const latestTweet = useAppSelector((state) => state.socket.latestTweet);
    const unreadDMConversations = useAppSelector((state) => state.socket.unreadDMConversations);
    useAppSelector((state) => state.socket.revision);

    const clearLatestNotificationAction = useCallback(() => { dispatch(clearLatestNotification()); }, [dispatch]);
    const clearLatestTweetAction = useCallback(() => { dispatch(clearLatestTweet()); }, [dispatch]);
    const decrementUnreadDMsAction = useCallback(() => { dispatch(decrementUnreadDMs()); }, [dispatch]);
    const clearUnreadDMConversationAction = useCallback((conversationId: string) => {
        dispatch(clearUnreadDMConversation(conversationId));
    }, [dispatch]);

    return {
        socket: getSocket(),
        isConnected,
        latestNotification,
        latestTweet,
        unreadDMsCount: Object.keys(unreadDMConversations).length,
        clearLatestNotification: clearLatestNotificationAction,
        clearLatestTweet: clearLatestTweetAction,
        decrementUnreadDMs: decrementUnreadDMsAction,
        clearUnreadDMConversation: clearUnreadDMConversationAction,
    };
};
