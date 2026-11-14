import { Router } from "express";
import { uploadMedia } from "../controllers/media.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";
import { mediaUpload } from "../lib/upload.js";

const router = Router();

router.post("/upload", authenticateToken as any, mediaUpload.single("file"), uploadMedia);

export default router;
