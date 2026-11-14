import jwt from 'jsonwebtoken';

const getAccessSecret = (): string => {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error("JWT_ACCESS_SECRET is not defined in environment variables");
    return secret;
};

const getRefreshSecret = (): string => {
    const secret = process.env.JWT_REFRESH_SECRET;
    if (!secret) throw new Error("JWT_REFRESH_SECRET is not defined in environment variables");
    return secret;
};

export interface TokenPayload {
    userId: string;
    username: string;
}

export const generateAccessToken = (payload: TokenPayload): string => {
    return jwt.sign(payload, getAccessSecret(), { expiresIn: "50m" });
};

export const generateRefreshToken = (payload: TokenPayload): string => {
    return jwt.sign(payload, getRefreshSecret(), { expiresIn: "7d" });
};

export const verifyAccessToken = (token: string): TokenPayload => {
    return jwt.verify(token, getAccessSecret()) as TokenPayload;
};

export const verifyRefreshToken = (token: string): TokenPayload => {
    return jwt.verify(token, getRefreshSecret()) as TokenPayload;
};