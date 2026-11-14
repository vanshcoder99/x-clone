import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
    loginWithGoogle, loginWithPassword, logoutAccount, refreshAuthUser, registerAccount,
} from "./authSlice";

export const useAuth = () => {
    const dispatch = useAppDispatch();
    const { user, loading } = useAppSelector((state) => state.auth);

    const login = useCallback((identifier: string, password: string) =>
        dispatch(loginWithPassword({ identifier, password })).unwrap(), [dispatch]);
    const register = useCallback((name: string, email: string, username: string, password: string) =>
        dispatch(registerAccount({ name, email, username, password })).unwrap(), [dispatch]);
    const googleLogin = useCallback((idToken: string) =>
        dispatch(loginWithGoogle(idToken)).unwrap(), [dispatch]);
    const logout = useCallback(() => dispatch(logoutAccount()).unwrap(), [dispatch]);
    const refreshUser = useCallback(async () => { await dispatch(refreshAuthUser()); }, [dispatch]);

    return { user, loading, login, register, googleLogin, logout, refreshUser };
};
