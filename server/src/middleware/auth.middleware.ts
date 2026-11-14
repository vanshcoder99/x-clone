import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type TokenPayload } from "../lib/jwt.js";


export interface AuthenticatedRequest extends Request {
    user?: TokenPayload;
}

export const authenticateToken = (req: AuthenticatedRequest,res:Response,next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

    if(!token){
        return res.status(401).json({error: "Access Token required"});
    }

    try {
        const decoded = verifyAccessToken(token);
        req.user = decoded;
        return next();
    } catch (error) {
        return res.status(403).json({ error: "Invalid or expired access token" });
    }
};

export const optionalAuthenticateToken = (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction
) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

    if (!token) {
        return next();
    }

    try {
        const decoded = verifyAccessToken(token);
        req.user = decoded;
    } catch {
        // Token is invalid/expired, continue as anonymous guest
    }

    return next();
};