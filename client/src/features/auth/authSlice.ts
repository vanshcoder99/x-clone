import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { isAxiosError } from "axios";
import { api, setAccessToken } from "../../api/client";
import type { User } from "../../types";

export interface AuthState {
    user: User | null;
    loading: boolean;
    initialized: boolean;
    initializing: boolean;
}

const initialState: AuthState = {
    user: null,
    loading: true,
    initialized: false,
    initializing: false,
};

interface AuthRequestError { message: string }

const getRequestError = (error: unknown): AuthRequestError => ({
    message: isAxiosError(error) && typeof error.response?.data?.error === "string"
        ? error.response.data.error
        : error instanceof Error ? error.message : "Authentication failed. Please try again.",
});

export const initializeAuth = createAsyncThunk<User | null, void, { state: { auth: AuthState } }>(
    "auth/initialize",
    async () => {
        try {
            const { data: refreshData } = await api.post("/auth/refresh", {});
            setAccessToken(refreshData.accessToken);
            const { data } = await api.get("/auth/me");
            return data.user as User;
        } catch {
            setAccessToken(null);
            return null;
        }
    },
    { condition: (_, { getState }) => !getState().auth.initialized && !getState().auth.initializing },
);

export const refreshAuthUser = createAsyncThunk<User | null>("auth/refreshUser", async () => {
    try {
        const { data } = await api.get("/auth/me");
        return data.user as User;
    } catch {
        return null;
    }
});

export const loginWithPassword = createAsyncThunk<User, { identifier: string; password: string }, { rejectValue: AuthRequestError }>("auth/login", async (credentials, { rejectWithValue }) => {
    try {
        const { data } = await api.post("/auth/login", credentials);
        setAccessToken(data.accessToken);
        const { data: current } = await api.get("/auth/me");
        return current.user as User;
    } catch (error) {
        return rejectWithValue(getRequestError(error));
    }
});

export const registerAccount = createAsyncThunk<User, { name: string; email: string; username: string; password: string }, { rejectValue: AuthRequestError }>("auth/register", async (details, { rejectWithValue }) => {
    try {
        const { data } = await api.post("/auth/register", details);
        setAccessToken(data.accessToken);
        const { data: current } = await api.get("/auth/me");
        return current.user as User;
    } catch (error) {
        return rejectWithValue(getRequestError(error));
    }
});

export const loginWithGoogle = createAsyncThunk<User, string, { rejectValue: AuthRequestError }>("auth/googleLogin", async (idToken, { rejectWithValue }) => {
    try {
        const { data } = await api.post("/auth/google", { idToken });
        setAccessToken(data.accessToken);
        const { data: current } = await api.get("/auth/me");
        return current.user as User;
    } catch (error) {
        return rejectWithValue(getRequestError(error));
    }
});

export const logoutAccount = createAsyncThunk<void>("auth/logout", async () => {
    try {
        await api.post("/auth/logout");
    } catch {
        setAccessToken(null);
        throw new Error("Could not complete server sign-out.");
    }
    setAccessToken(null);
});

const authSlice = createSlice({
    name: "auth",
    initialState,
    reducers: {
        clearAuthenticatedUser(state) {
            state.user = null;
            state.loading = false;
            state.initialized = true;
            state.initializing = false;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(initializeAuth.pending, (state) => { state.initializing = true; })
            .addCase(initializeAuth.fulfilled, (state, action) => {
                state.user = action.payload;
                state.loading = false;
                state.initialized = true;
                state.initializing = false;
            })
            .addCase(initializeAuth.rejected, (state) => {
                state.loading = false;
                state.initialized = true;
                state.initializing = false;
            })
            .addCase(refreshAuthUser.fulfilled, (state, action) => { state.user = action.payload; })
            .addCase(loginWithPassword.fulfilled, (state, action) => { state.user = action.payload; state.loading = false; })
            .addCase(registerAccount.fulfilled, (state, action) => { state.user = action.payload; state.loading = false; })
            .addCase(loginWithGoogle.fulfilled, (state, action) => { state.user = action.payload; state.loading = false; })
            .addCase(logoutAccount.fulfilled, (state) => { state.user = null; state.loading = false; })
            .addCase(logoutAccount.rejected, (state) => { state.user = null; state.loading = false; });
    },
});

export const { clearAuthenticatedUser } = authSlice.actions;
export default authSlice.reducer;
