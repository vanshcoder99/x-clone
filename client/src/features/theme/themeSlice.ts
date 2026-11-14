import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";

export type Theme = "dark" | "light";

const readSavedTheme = (): Theme => {
    if (typeof window === "undefined") return "dark";
    return localStorage.getItem("socialsphere_theme") === "light" ? "light" : "dark";
};

export interface ThemeState { theme: Theme }
const initialState: ThemeState = { theme: readSavedTheme() };

const applyThemeToDocument = (theme: Theme) => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;
};

export const changeTheme = createAsyncThunk<Theme, Theme | undefined, { state: { theme: ThemeState } }>(
    "theme/change",
    (requestedTheme, { getState }) => {
        const theme = requestedTheme ?? (getState().theme.theme === "dark" ? "light" : "dark");
        localStorage.setItem("socialsphere_theme", theme);
        applyThemeToDocument(theme);
        return theme;
    },
);

export const syncInitialTheme = () => applyThemeToDocument(initialState.theme);

const themeSlice = createSlice({
    name: "theme",
    initialState,
    reducers: {},
    extraReducers: (builder) => builder.addCase(changeTheme.fulfilled, (state, action) => { state.theme = action.payload; }),
});

export default themeSlice.reducer;
