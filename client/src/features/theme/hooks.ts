import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { changeTheme, type Theme } from "./themeSlice";

export const useTheme = () => {
    const dispatch = useAppDispatch();
    const theme = useAppSelector((state) => state.theme.theme);
    const setTheme = useCallback((nextTheme: Theme) => { void dispatch(changeTheme(nextTheme)); }, [dispatch]);
    const toggleTheme = useCallback(() => { void dispatch(changeTheme()); }, [dispatch]);
    return { theme, setTheme, toggleTheme };
};
