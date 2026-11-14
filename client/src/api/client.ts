import axios from "axios";

const rawApiUrl = (import.meta.env.VITE_API_URL || "http://localhost:5000/api").trim().replace(/\/$/, "");
const API_BASE_URL = rawApiUrl.endsWith("/api") ? rawApiUrl : `${rawApiUrl}/api`;

export const api = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true, // Enables cookies for refreshToken
    timeout: 15000, // Request timeout to prevent indefinite loading spinners
    headers: {
        "Content-Type": "application/json",
    },
});

let currentAccessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
    currentAccessToken = token;
};

export const getAccessToken = () => currentAccessToken;

// Request interceptor: Attach Bearer token if available
api.interceptors.request.use((config) => {
    if (typeof FormData !== "undefined" && config.data instanceof FormData && config.headers) {
        delete config.headers["Content-Type"];
        delete config.headers["content-type"];
    }
    if (currentAccessToken && config.headers) {
        config.headers.Authorization = `Bearer ${currentAccessToken}`;
    }
    return config;
});

// Response interceptor: Auto-refresh on 403/401
let isRefreshing = false;
let failedQueue: Array<{
    resolve: (token: string) => void;
    reject: (error: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null = null) => {
    failedQueue.forEach((promise) => {
        if (token) {
            promise.resolve(token);
        } else {
            promise.reject(error);
        }
    });
    failedQueue = [];
};

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        if (
            (error.response?.status === 403 || error.response?.status === 401) &&
            !originalRequest._retry &&
            !originalRequest.url?.includes("/auth/refresh") &&
            !originalRequest.url?.includes("/auth/login") &&
            !originalRequest.url?.includes("/auth/register")
        ) {
            if (isRefreshing) {
                return new Promise((resolve, reject) => {
                    failedQueue.push({ resolve, reject });
                })
                    .then((token) => {
                        originalRequest.headers.Authorization = `Bearer ${token}`;
                        return api(originalRequest);
                    })
                    .catch((err) => Promise.reject(err));
            }

            originalRequest._retry = true;
            isRefreshing = true;

            try {
                const { data } = await axios.post(
                    `${API_BASE_URL}/auth/refresh`,
                    {},
                    { withCredentials: true }
                );

                const newAccessToken = data.accessToken;
                setAccessToken(newAccessToken);
                originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;

                processQueue(null, newAccessToken);
                return api(originalRequest);
            } catch (refreshErr) {
                processQueue(refreshErr, null);
                setAccessToken(null);
                if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("auth:unauthorized"));
                }
                return Promise.reject(refreshErr);
            } finally {
                isRefreshing = false;
            }
        }

        return Promise.reject(error);
    }
);
