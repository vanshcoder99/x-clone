import { Router } from "express";
import {
    cancelSubscription,
    cancelPendingSubscription,
    createSubscription,
    getBillingOverview,
    listPlans,
    verifySubscriptionCheckout,
} from "../controllers/billing.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const router = Router();

router.get("/plans", listPlans);
router.get("/me", authenticateToken as any, getBillingOverview);
router.post("/subscriptions", authenticateToken as any, createSubscription);
router.post("/subscriptions/verify", authenticateToken as any, verifySubscriptionCheckout);
router.post("/subscriptions/cancel", authenticateToken as any, cancelSubscription);
router.post("/subscriptions/:subscriptionId/cancel-pending", authenticateToken as any, cancelPendingSubscription);

export default router;
