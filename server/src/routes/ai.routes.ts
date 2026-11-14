import { Router } from "express";
import { suggestTweet, suggestHashtags } from "../controllers/ai.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = Router();

router.post("/suggest-tweet", authenticateToken as any, suggestTweet);
router.post("/suggest-hashtags", authenticateToken as any, suggestHashtags);

export default router;
