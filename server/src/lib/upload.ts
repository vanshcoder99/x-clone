import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import multer from "multer";

export const uploadDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../uploads");
fs.mkdirSync(uploadDirectory, { recursive: true });

const supportedMimeExtensions: Record<string, string[]> = {
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/webp": [".webp"],
    "image/gif": [".gif"],
    "video/mp4": [".mp4"],
    "video/quicktime": [".mov"],
    "video/webm": [".webm"],
};

export const mediaUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, callback) => callback(null, uploadDirectory),
        filename: (_req, file, callback) => {
            const extension = path.extname(file.originalname).toLowerCase();
            callback(null, `${crypto.randomUUID()}${extension}`);
        },
    }),
    limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase();
        const validExtensions = supportedMimeExtensions[file.mimetype];
        if (!validExtensions || !validExtensions.includes(extension)) {
            callback(new Error("Unsupported media format. Choose a supported image or video file."));
            return;
        }
        callback(null, true);
    },
});
