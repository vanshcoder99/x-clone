import { configureStore } from "@reduxjs/toolkit";
import authReducer from "../features/auth/authSlice";
import socketReducer from "../features/socket/socketSlice";
import themeReducer from "../features/theme/themeSlice";

export const store = configureStore({
    reducer: {
        auth: authReducer,
        theme: themeReducer,
        socket: socketReducer,
    },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
