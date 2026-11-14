import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

const getFirebaseAuth = () => {
    const requiredValues = [firebaseConfig.apiKey, firebaseConfig.authDomain, firebaseConfig.projectId, firebaseConfig.appId];
    if (requiredValues.some((value) => !value)) {
        throw new Error("Google sign-in is not configured. Set the VITE_FIREBASE_* client environment variables.");
    }
    const apiKey = firebaseConfig.apiKey?.trim() || "";
    if (!/^AIza[0-9A-Za-z_-]{35}$/.test(apiKey) || /dummy|placeholder|replace|your_/i.test(apiKey)) {
        throw new Error(
            "Firebase setup error: VITE_FIREBASE_API_KEY is missing or is a placeholder. Copy the Web API key from Firebase Console → Project settings → General → Your apps into client/.env, then restart Vite."
        );
    }
    const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    return getAuth(app);
};

/**
 * Initiates the Firebase Google Sign-In popup flow and returns the Google ID Token.
 */
export const signInWithGooglePopup = async (): Promise<string> => {
    const result = await signInWithPopup(getFirebaseAuth(), googleProvider);
    return result.user.getIdToken();
};

