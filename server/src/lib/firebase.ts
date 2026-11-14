import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";

export const verifyFirebaseIdToken = async (idToken: string): Promise<DecodedIdToken> => {
    const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
    const app = getApps()[0] ?? initializeApp(projectId ? { projectId } : {});
    return getAuth(app).verifyIdToken(idToken);
};
