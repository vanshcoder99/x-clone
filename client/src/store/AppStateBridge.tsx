import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "./hooks";
import { initializeAuth, clearAuthenticatedUser } from "../features/auth/authSlice";
import { connectSocket } from "../features/socket/socketService";
import { resetSocketState } from "../features/socket/socketSlice";
import { syncInitialTheme } from "../features/theme/themeSlice";
import { setAccessToken } from "../api/client";

export const AppStateBridge = () => {
    const dispatch = useAppDispatch();
    const userId = useAppSelector((state) => state.auth.user?.id);

    useEffect(() => {
        void dispatch(initializeAuth());
        syncInitialTheme();
        const handleUnauthorized = () => {
            setAccessToken(null);
            dispatch(clearAuthenticatedUser());
        };
        window.addEventListener("auth:unauthorized", handleUnauthorized);
        return () => window.removeEventListener("auth:unauthorized", handleUnauthorized);
    }, [dispatch]);

    useEffect(() => {
        if (userId) return connectSocket(userId, dispatch);
        dispatch(resetSocketState());
        return undefined;
    }, [dispatch, userId]);

    return null;
};
