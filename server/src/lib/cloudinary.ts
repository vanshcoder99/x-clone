import { v2 as cloudinary } from "cloudinary";

export const getCloudinary = () => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
    const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

    if (!cloudName || !apiKey || !apiSecret) {
        throw new Error("Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.");
    }

    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    return cloudinary;
};

export const deleteCloudinaryAsset = async (
    publicId: string,
    resourceType: "image" | "video" = "image"
) => {
    if (!publicId) return { success: false, error: "Public ID is required for deletion" };
    try {
        const result = await getCloudinary().uploader.destroy(publicId, { resource_type: resourceType });
        return result.result === "ok"
            ? { success: true, result: result.result }
            : { success: false, result: result.result, error: "Cloudinary did not confirm asset deletion" };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Cloudinary deletion failed" };
    }
};
