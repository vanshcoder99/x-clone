import type { Response } from "express";
import fs from "fs/promises";
import path from "path";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { prisma } from "../index.js";
import { getCloudinary } from "../lib/cloudinary.js";
import { uploadDirectory } from "../lib/upload.js";

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024;

const inspectMedia = (file: Express.Multer.File) => {
    const bytes = fs.readFile(file.path);
    return bytes.then((buffer) => {
        const starts = (...signature: number[]) => signature.every((byte, index) => buffer[index] === byte);
        const ascii = (start: number, end: number) => buffer.toString("ascii", start, end);
        const extension = path.extname(file.originalname).toLowerCase();

        let mediaType: "IMAGE" | "VIDEO" | "GIF";
        let resourceType: "image" | "video";
        let validSignature = false;

        if (extension === ".jpg" || extension === ".jpeg") {
            mediaType = "IMAGE"; resourceType = "image"; validSignature = starts(0xff, 0xd8, 0xff);
        } else if (extension === ".png") {
            mediaType = "IMAGE"; resourceType = "image"; validSignature = starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
        } else if (extension === ".gif") {
            mediaType = "GIF"; resourceType = "image"; validSignature = ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a";
        } else if (extension === ".webp") {
            mediaType = "IMAGE"; resourceType = "image"; validSignature = ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
        } else if ([".mp4", ".mov"].includes(extension)) {
            mediaType = "VIDEO"; resourceType = "video"; validSignature = ascii(4, 8) === "ftyp";
        } else {
            mediaType = "VIDEO"; resourceType = "video"; validSignature = starts(0x1a, 0x45, 0xdf, 0xa3);
        }

        return { mediaType, resourceType, validSignature };
    });
};

const removeTemporaryFile = async (filePath?: string) => {
    if (!filePath) return;
    try {
        await fs.unlink(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            console.error("Unable to remove temporary media file:", error);
        }
    }
};

const getSafeUploadFailure = (error: unknown) => {
    const value = error && typeof error === "object"
        ? error as { name?: unknown; message?: unknown; http_code?: unknown; code?: unknown; response?: { status?: unknown } }
        : {};
    let message = typeof value.message === "string" ? value.message : "Unknown upload error";
    for (const secret of [process.env.CLOUDINARY_API_KEY, process.env.CLOUDINARY_API_SECRET]) {
        if (secret) message = message.split(secret).join("[redacted]");
    }
    const status = typeof value.http_code === "number"
        ? value.http_code
        : typeof value.response?.status === "number" ? value.response.status : undefined;
    return { name: typeof value.name === "string" ? value.name : "Error", message, status, code: value.code };
};

export const uploadMedia = async (req: AuthenticatedRequest, res: Response) => {
    const file = req.file;
    let cloudinaryAsset: { publicId: string; resourceType: "image" | "video" } | null = null;
    let uploadRecordSaved = false;

    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        if (!file) return res.status(400).json({ error: "Select an image or video to upload." });

        const detected = await inspectMedia(file);
        if (!detected.validSignature) {
            return res.status(400).json({ error: "The uploaded file content does not match a supported image or video format." });
        }

        const maxSize = detected.resourceType === "video" ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
        if (file.size > maxSize) {
            return res.status(413).json({ error: detected.resourceType === "video" ? "Videos may not exceed 50MB." : "Images may not exceed 10MB." });
        }

        const cloud = getCloudinary();
        const folder = `socialsphere/users/${userId}/media`;
        const result = await cloud.uploader.upload(file.path, {
            folder,
            resource_type: detected.resourceType,
            use_filename: false,
            unique_filename: true,
            overwrite: false,
        });

        cloudinaryAsset = { publicId: result.public_id, resourceType: detected.resourceType };
        if (!result.secure_url) throw new Error("Cloudinary did not return a secure URL.");

        await prisma.pendingUpload.create({
            data: {
                userId,
                publicId: result.public_id,
                url: result.secure_url,
                folder,
                resourceType: detected.resourceType,
                mediaType: detected.mediaType,
                status: "PENDING",
                expiresAt: new Date(Date.now() + 30 * 60 * 1000),
            },
        });
        uploadRecordSaved = true;

        return res.status(201).json({
            url: result.secure_url,
            publicId: result.public_id,
            mediaType: detected.mediaType,
            resourceType: detected.resourceType,
            format: result.format,
            width: result.width,
            height: result.height,
        });
    } catch (error) {
        const failure = getSafeUploadFailure(error);
        console.error("Media upload failed:", failure);
        if (cloudinaryAsset && !uploadRecordSaved) {
            try {
                await getCloudinary().uploader.destroy(cloudinaryAsset.publicId, {
                    resource_type: cloudinaryAsset.resourceType,
                });
            } catch (cleanupError) {
                console.error("Unable to remove orphaned Cloudinary media:", getSafeUploadFailure(cleanupError));
            }
        }
        if (failure.message.includes("Cloudinary is not configured")) {
            return res.status(503).json({ error: "Cloudinary media storage is not configured on the server." });
        }
        if (failure.status === 401 || failure.status === 403) {
            return res.status(502).json({ error: "Cloudinary rejected the configured credentials. Verify the Cloud name, API key, and API secret." });
        }
        return res.status(502).json({ error: "Media upload failed. Please try again." });
    } finally {
        if (file?.path && path.dirname(path.resolve(file.path)) === path.resolve(uploadDirectory)) {
            await removeTemporaryFile(file.path);
        }
    }
};
