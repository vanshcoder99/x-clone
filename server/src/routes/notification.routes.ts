import { Router } from "express";
import {
    getNotifications,
    markNotificationsRead,
} from "../controllers/notification.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = Router();

router.get("/", authenticateToken as any, getNotifications);
router.patch("/read", authenticateToken as any, markNotificationsRead);

export default router;
