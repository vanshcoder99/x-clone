import jwt from 'jsonwebtoken'

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

export interface TokenPayload {
    userId: string;
    username: string;
}

export const generateAccessToken = (payload: TokenPayload): string => {
    if (!ACCESS_SECRET) throw new Error("ACCESS_SECRET not defined");
    return jwt.sign(payload,ACCESS_SECRET,{expiresIn: "50m"});
}

export const generateRefreshToken = (payload: TokenPayload): string => {
    if (!REFRESH_SECRET) throw new Error("REFRESH_SECRET not defined");
    return jwt.sign(payload,REFRESH_SECRET,{expiresIn: "7d"});
}

export const verifyAccessToken = (token: string): TokenPayload => {
    if (!ACCESS_SECRET) throw new Error("ACCESS_SECRET not defined");
    return jwt.verify(token,ACCESS_SECRET) as TokenPayload;
}

export const verifyRefreshToken = (token: string): TokenPayload => {
    if (!REFRESH_SECRET) throw new Error("REFRESH_SECRET not defined");
    return jwt.verify(token,REFRESH_SECRET) as TokenPayload;
}