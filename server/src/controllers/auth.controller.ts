import type { Request,Response } from "express";
import {prisma} from '../index.js';
import bcrypt from 'bcryptjs';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from "../lib/jwt.js";


const COOKIE_OPTIONS = {
  httpOnly: true, 
  secure: process.env.NODE_ENV === "production", 
  sameSite: "lax" as const, 
  maxAge: 7 * 24 * 60 * 60 * 1000, 
};

export const registerUser = async (req: Request,res: Response) => {
    try{
        const {email,username,password} = req.body;

        if(!email || !username || !password){
            return res.status(400).json({ error: "All fields are required" });
        }
        
        if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
        }

        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [{email},{username}]
            }
        });

        if(existingUser){
            const field = existingUser.email === email ? "email" : "username";
            return res.status(409).json({error: `${field} is already in use`});
        }

        const hashedPassword = await bcrypt.hash(password,10);

        const newUser = await prisma.user.create({
            data: {
                email,
                username,
                password: hashedPassword,
                provider: "LOCAL",
            },
            select: {
            id: true,
            username: true,
            email: true,
            bio: true,
            avatarUrl: true,
            isVerified: true,
            createdAt: true,
        },
        });

        const tokenPayload = {userId: newUser.id, username: newUser.username}
        const accessToken = generateAccessToken(tokenPayload)
        const refreshToken = generateRefreshToken(tokenPayload)

        const expiresAt = new Date(Date.now() + 7*24*60*60*1000);

        await prisma.refreshToken.create({
            data: {
                token: refreshToken,
                userId: newUser.id,
                expiresAt,
            },
        });

        res.cookie("refreshToken",refreshToken,COOKIE_OPTIONS);

        return res.status(201).json({
        message: "User registered successfully",
        user: newUser,
        accessToken,
        });
    } 
    catch (error) {
        console.error("Error in registerUser:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};


export const loginUser = async (req:Request,res:Response) => {
    try {
        const {identifier,password} = req.body;

        if(!identifier || !password){
            return res.status(400).json({ error: "Username/Email and password are required" });
        }

        const user = await prisma.user.findFirst({
            where: {
                OR: [{email: identifier},{username: identifier}],
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

        const isPasswordValid = await bcrypt.compare(password,user.password);

        if (!isPasswordValid) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

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

        res.cookie("refreshToken", refreshToken, COOKIE_OPTIONS);

        return res.status(200).json({
            message: "Logged in successfully",
            user: {
                id: user.id,
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
}


export const logoutUser = async (req:Request,res: Response) => {
    try {
        const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

        if(refreshToken){
            await prisma.refreshToken.deleteMany({
                where: {token: refreshToken},
            })
        }

        res.clearCookie("refreshToken",COOKIE_OPTIONS);
        
        return res.status(200).json({ message: "Logged out successfully" });

    } catch (error) {
        console.error("Error in logoutUser:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
}


export const refreshAccessToken = async (req: Request,res:Response) => {
    try {
        
        const incomingRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

        if (!incomingRefreshToken) {
            return res.status(401).json({ error: "Refresh token missing" });
        }

        let decoded;
        try {
            decoded = verifyRefreshToken(incomingRefreshToken);
        } catch (error) {
            return res.status(403).json({error: "Invalid or expired refresh token"})
        };

        const savedToken = await prisma.refreshToken.findUnique({
            where: {token: incomingRefreshToken},
        });

        if (!savedToken) {
            return res.status(403).json({ error: "Refresh token revoked or not found" });
        }

        if(new Date(savedToken.expiresAt) < new Date()){
            await prisma.refreshToken.delete({where: {token: incomingRefreshToken}});

            return res.status(403).json({error: "Refresh Token expired"});
        }

        const newAccessToken = generateAccessToken({
            userId: decoded.userId,
            username: decoded.username
        });

        return res.status(200).json({ accessToken: newAccessToken });



    } catch (error) {
         console.error("Error in refreshAccessToken:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
}