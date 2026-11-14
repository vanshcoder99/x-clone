import type { Request, Response } from "express";
import { prisma } from '../index.js';
import bcrypt from 'bcryptjs';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../lib/jwt.js";
import { verifyFirebaseIdToken } from "../lib/firebase.js";
import { getUserEntitlements } from "../lib/entitlements.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";

export const getCookieOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: (process.env.NODE_ENV === "production" ? "none" : "lax") as "none" | "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
});

const isValidEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const isValidUsername = (username: string): boolean => {
    return /^[a-zA-Z0-9_]{3,30}$/.test(username);
};

export const registerUser = async (req: Request, res: Response) => {
    try {
        const { name, email, username, password } = req.body;

        if (!name || !email || !username || !password) {
            return res.status(400).json({ error: "All fields are required" });
        }

        if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 80) {
            return res.status(400).json({ error: "Full name must be between 1 and 80 characters" });
        }

        const trimmedEmail = String(email).trim().toLowerCase();
        const trimmedUsername = String(username).trim();

        if (!isValidEmail(trimmedEmail)) {
            return res.status(400).json({ error: "Please enter a valid email address" });
        }

        if (!isValidUsername(trimmedUsername)) {
            return res.status(400).json({
                error: "Username must be 3-30 characters and contain only letters, numbers, and underscores",
            });
        }

        if (typeof password !== "string" || password.length < 6) {
            return res.status(400).json({ error: "Password must be at least 6 characters" });
        }

        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [{ email: trimmedEmail }, { username: trimmedUsername }]
            }
        });

        if (existingUser) {
            const field = existingUser.email === trimmedEmail ? "Email" : "Username";
            return res.status(409).json({ error: `${field} is already in use` });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: {
                name: name.trim(),
                email: trimmedEmail,
                username: trimmedUsername,
                password: hashedPassword,
                provider: "LOCAL",
            },
            select: {
                id: true,
                name: true,
                username: true,
                email: true,
                bio: true,
                avatarUrl: true,
                isVerified: true,
                isPrivate: true,
                createdAt: true,
            },
        });

        const tokenPayload = { userId: newUser.id, username: newUser.username };
        const accessToken = generateAccessToken(tokenPayload);
        const refreshToken = generateRefreshToken(tokenPayload);

        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await prisma.refreshToken.create({
            data: {
                token: refreshToken,
                userId: newUser.id,
                expiresAt,
            },
        });

        res.cookie("refreshToken", refreshToken, getCookieOptions());

        return res.status(201).json({
            message: "User registered successfully",
            user: newUser,
            accessToken,
        });
    }
    catch (error) {
        if ((error as any)?.code === "P2002") {
            return res.status(409).json({ error: "Email or username is already in use" });
        }
        console.error("Error in registerUser:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};


export const loginUser = async (req: Request, res: Response) => {
    try {
        const { identifier, password } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({ error: "Username/Email and password are required" });
        }

        const trimmedIdentifier = String(identifier).trim();

        const user = await prisma.user.findFirst({
            where: {
                OR: [
                    { email: trimmedIdentifier.toLowerCase() },
                    { username: trimmedIdentifier },
                ],
            }
        });

        if (!user) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        if (!user.password) {
            return res.status(400).json({
                error: "This account uses Google Sign-In. Please log in with Google.",
            });
        }

        const isPasswordValid = await bcrypt.compare(String(password), user.password);

        if (!isPasswordValid) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        // Clean up expired tokens for this user on successful login
        await prisma.refreshToken.deleteMany({
            where: {
                userId: user.id,
                expiresAt: { lt: new Date() },
            },
        });

        const tokenPayload = { userId: user.id, username: user.username };
        const accessToken = generateAccessToken(tokenPayload);
        const refreshToken = generateRefreshToken(tokenPayload);

        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await prisma.refreshToken.create({
            data: {
                token: refreshToken,
                userId: user.id,
                expiresAt,
            },
        });

        res.cookie("refreshToken", refreshToken, getCookieOptions());

        return res.status(200).json({
            message: "Logged in successfully",
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                email: user.email,
                bio: user.bio,
                avatarUrl: user.avatarUrl,
                isVerified: user.isVerified,
                createdAt: user.createdAt,
            },
            accessToken,
        });
    }
    catch (error) {
        console.error("Error in loginUser:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

export const changePassword = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const { currentPassword, newPassword } = req.body;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
            return res.status(400).json({ error: "Current and new passwords are required" });
        }
        if (newPassword.length < 8 || newPassword.length > 128) {
            return res.status(400).json({ error: "New password must be between 8 and 128 characters" });
        }
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
        if (!user?.password) {
            return res.status(400).json({ error: "This account does not have a password. Sign in with Google." });
        }
        if (!(await bcrypt.compare(currentPassword, user.password))) {
            return res.status(400).json({ error: "Current password is incorrect" });
        }
        if (await bcrypt.compare(newPassword, user.password)) {
            return res.status(400).json({ error: "Choose a password different from your current one" });
        }
        await prisma.user.update({ where: { id: userId }, data: { password: await bcrypt.hash(newPassword, 12) } });
        return res.status(200).json({ message: "Password changed successfully" });
    } catch (error) {
        console.error("Error in changePassword:", error);
        return res.status(500).json({ error: "Unable to change password" });
    }
};


export const logoutUser = async (req: Request, res: Response) => {
    try {
        const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

        if (refreshToken) {
            await prisma.refreshToken.deleteMany({
                where: { token: refreshToken },
            });
        }

        res.clearCookie("refreshToken", getCookieOptions());

        return res.status(200).json({ message: "Logged out successfully" });

    } catch (error) {
        console.error("Error in logoutUser:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};


export const refreshAccessToken = async (req: Request, res: Response) => {
    try {
        const incomingRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

        if (!incomingRefreshToken) {
            return res.status(401).json({ error: "Refresh token missing" });
        }

        let decoded;
        try {
            decoded = verifyRefreshToken(incomingRefreshToken);
        } catch (error) {
            return res.status(403).json({ error: "Invalid or expired refresh token" });
        }

        const savedToken = await prisma.refreshToken.findUnique({
            where: { token: incomingRefreshToken },
        });

        if (!savedToken) {
            return res.status(403).json({ error: "Refresh token revoked or not found" });
        }

        if (new Date(savedToken.expiresAt) < new Date()) {
            await prisma.refreshToken.delete({ where: { token: incomingRefreshToken } });
            return res.status(403).json({ error: "Refresh token expired" });
        }

        const tokenPayload = {
            userId: decoded.userId,
            username: decoded.username,
        };

        const newAccessToken = generateAccessToken(tokenPayload);
        const newRefreshToken = generateRefreshToken(tokenPayload);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        // Atomic Refresh Token Rotation: Delete old token and insert rotated token
        await prisma.$transaction([
            prisma.refreshToken.delete({ where: { token: incomingRefreshToken } }),
            prisma.refreshToken.create({
                data: {
                    token: newRefreshToken,
                    userId: decoded.userId,
                    expiresAt,
                },
            }),
        ]);

        res.cookie("refreshToken", newRefreshToken, getCookieOptions());

        return res.status(200).json({
            accessToken: newAccessToken,
        });

    } catch (error) {
        console.error("Error in refreshAccessToken:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};


export const googleAuth = async (req: Request, res: Response) => {
    try {
        const { idToken } = req.body;

        if (!idToken || typeof idToken !== "string") {
            return res.status(400).json({ error: "Google ID token is required" });
        }

        const decodedToken = await verifyFirebaseIdToken(idToken);
        const uid = decodedToken.uid;
        const email = decodedToken.email?.trim().toLowerCase();
        const verifiedName = typeof decodedToken.name === "string" ? decodedToken.name.trim() : "";
        const picture = typeof decodedToken.picture === "string" ? decodedToken.picture : null;

        if (!uid || !email || decodedToken.email_verified !== true) {
            return res.status(401).json({ error: "Google account must provide a verified email address" });
        }

        let user = await prisma.user.findUnique({ where: { firebaseUid: uid } });
        if (!user) {
            const emailMatch = await prisma.user.findUnique({ where: { email } });
            if (emailMatch?.firebaseUid && emailMatch.firebaseUid !== uid) {
                return res.status(409).json({ error: "This email is already linked to another Google account" });
            }
            if (emailMatch) {
                // Link only after Firebase has verified control of this exact email.
                user = await prisma.user.update({
                    where: { id: emailMatch.id },
                    data: {
                        firebaseUid: uid,
                        provider: "GOOGLE",
                        ...(!emailMatch.name && verifiedName ? { name: verifiedName } : {}),
                        ...(!emailMatch.avatarUrl && picture ? { avatarUrl: picture } : {}),
                    },
                });
            } else {
                const base = (verifiedName || email.split("@")[0] || "member")
                    .toLowerCase()
                    .replace(/[^a-z0-9_]/g, "")
                    .slice(0, 20) || "member";
                let username = base.length >= 3 ? base : `user_${base}`;
                for (let suffix = 1; await prisma.user.findUnique({ where: { username } }); suffix++) {
                    username = `${base.slice(0, 20 - String(suffix).length - 1)}_${suffix}`;
                }
                user = await prisma.user.create({
                    data: {
                        name: verifiedName || null,
                        email,
                        username,
                        avatarUrl: picture,
                        firebaseUid: uid,
                        provider: "GOOGLE",
                        password: null,
                    },
                });
            }
        } else if (user.email !== email || (!user.name && verifiedName) || (!user.avatarUrl && picture)) {
            // Sync the verified provider email; fill provider fields only when no profile value exists.
            user = await prisma.user.update({
                where: { id: user.id },
                data: {
                    ...(user.email !== email ? { email } : {}),
                    ...(!user.name && verifiedName ? { name: verifiedName } : {}),
                    ...(!user.avatarUrl && picture ? { avatarUrl: picture } : {}),
                },
            });
        }

        // Clean up expired tokens for this user
        await prisma.refreshToken.deleteMany({
            where: {
                userId: user.id,
                expiresAt: { lt: new Date() },
            },
        });

        const tokenPayload = { userId: user.id, username: user.username };
        const accessToken = generateAccessToken(tokenPayload);
        const refreshToken = generateRefreshToken(tokenPayload);

        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await prisma.refreshToken.create({
            data: {
                token: refreshToken,
                userId: user.id,
                expiresAt,
            },
        });

        res.cookie("refreshToken", refreshToken, getCookieOptions());

        return res.status(200).json({
            message: "Signed in with Google successfully",
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                email: user.email,
                bio: user.bio,
                avatarUrl: user.avatarUrl,
                isVerified: user.isVerified,
                createdAt: user.createdAt,
            },
            accessToken,
        });

    } catch (error) {
        if ((error as any)?.code === "P2002") {
            return res.status(409).json({ error: "This Google account or email is already linked" });
        }
        if (error instanceof Error && /Firebase|token|credential|project/i.test(error.message)) {
            return res.status(401).json({ error: "Google authentication could not be verified. Please try again." });
        }
        console.error("Error in googleAuth:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

export const getCurrentUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                name: true,
                username: true,
                email: true,
                bio: true,
                avatarUrl: true,
                isVerified: true,
                isPrivate: true,
                password: true,
                createdAt: true,
            }
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const entitlements = await getUserEntitlements(userId);
        return res.status(200).json({
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                email: user.email,
                bio: user.bio,
                avatarUrl: user.avatarUrl,
                hasPassword: Boolean(user.password),
                isVerified: entitlements.verifiedBadge,
                isPrivate: user.isPrivate,
                createdAt: user.createdAt,
                subscription: { tier: entitlements.tier, status: entitlements.subscriptionStatus },
                entitlements,
            },
        });
    } catch (error) {
        console.error("Error in getCurrentUser:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};
