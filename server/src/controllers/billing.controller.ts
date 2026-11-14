import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { prisma } from "../index.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { getUserEntitlements } from "../lib/entitlements.js";
import { getCachedRazorpayPlanId, getRazorpayPlanId, cacheRazorpayPlanId, PAID_PLAN_ORDER, PLAN_CONFIG, type PaidPlan } from "../lib/plan-config.js";
import { razorpayKeyId, razorpayRequest, verifyOrderPaymentSignature, verifySubscriptionCheckoutSignature, verifyWebhookSignature } from "../lib/razorpay.js";

interface RazorpayPlan {
    id: string; period: string; interval: number;
    item?: { amount?: number; currency?: string };
}
interface RazorpaySubscription {
    id: string; plan_id: string; status: string;
    current_start?: number | null; current_end?: number | null;
}
interface RazorpayOrder {
    id: string; entity: "order"; amount: number; amount_paid: number; amount_due: number;
    currency: string; receipt?: string; status: string; created_at?: number;
}
interface RazorpayPayment {
    id: string; subscription_id?: string | null; order_id?: string | null; amount: number; currency: string;
    status: string; captured?: boolean; created_at?: number;
}

const eventMillis = (value: unknown, fallback = Date.now()) =>
    typeof value === "number" && Number.isFinite(value) ? value * 1000 : fallback;

const publicPlan = (tier: "FREE" | PaidPlan) => {
    const { tier: _tier, ...details } = PLAN_CONFIG[tier];
    return { tier, ...details };
};

export const listPlans = (_req: Request, res: Response) =>
    res.json({ plans: [publicPlan("FREE"), ...PAID_PLAN_ORDER.map(publicPlan)], currency: "INR", billingFrequency: "monthly" });

export const getBillingOverview = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        const [entitlements, subscriptions, payments] = await Promise.all([
            getUserEntitlements(userId),
            prisma.razorpaySubscription.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 }),
            prisma.billingPayment.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 }),
        ]);
        const current = subscriptions.find((item) => item.status === "ACTIVE" || (item.status === "CANCELLED" && item.cancelAtPeriodEnd))
            || subscriptions.find((item) => item.status === "PENDING")
            || subscriptions[0]
            || null;
        return res.json({ entitlements, subscription: current || subscriptions[0] || null, subscriptions, payments });
    } catch (error) {
        console.error("Unable to load billing overview:", error);
        return res.status(500).json({ error: "Unable to load billing details." });
    }
};

export const createSubscription = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        const tier = req.body?.plan;
        if (tier !== "PLUS" && tier !== "PRO") return res.status(400).json({ error: "Select a valid paid plan." });
        const paidTier = tier as PaidPlan;
        const expected = PLAN_CONFIG[paidTier];

        // Check if there is an existing pending checkout for this user
        const pending = await prisma.razorpaySubscription.findFirst({
            where: { userId, status: "PENDING" },
            orderBy: { createdAt: "desc" },
        });
        if (pending) {
            const isFresh = (Date.now() - pending.createdAt.getTime()) < 15 * 60 * 1000;
            if (pending.tier === tier && isFresh) {
                const isOrder = pending.razorpaySubscriptionId.startsWith("order_");
                return res.status(200).json({
                    subscription: { id: pending.id, razorpaySubscriptionId: pending.razorpaySubscriptionId, tier: pending.tier },
                    checkout: {
                        keyId: razorpayKeyId(),
                        ...(isOrder ? { orderId: pending.razorpaySubscriptionId } : { subscriptionId: pending.razorpaySubscriptionId }),
                        name: "SocialSphere",
                        description: `${expected.name} monthly subscription`,
                        amountInr: expected.priceInr,
                        amountPaise: expected.pricePaise,
                        currency: "INR",
                        prefill: await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
                    },
                });
            }
            // Close stale or mismatched pending checkout so it does not block the user
            await prisma.razorpaySubscription.update({
                where: { id: pending.id },
                data: { status: "CANCELLED" },
            });
        }

        let planId = getRazorpayPlanId(paidTier) || getCachedRazorpayPlanId(paidTier);
        let createdSubscriptionId: string | null = null;
        let createdOrderId: string | null = null;

        // Try recurring subscription first IF a plan ID is explicitly configured
        if (planId) {
            try {
                const remotePlan = await razorpayRequest<RazorpayPlan>(`/plans/${encodeURIComponent(planId)}`, "GET");
                if (remotePlan.id === planId && remotePlan.item?.amount === expected.pricePaise && remotePlan.item?.currency === "INR") {
                    const created = await razorpayRequest<RazorpaySubscription>("/subscriptions", "POST", {
                        plan_id: planId,
                        total_count: 1200,
                        quantity: 1,
                        customer_notify: true,
                        notes: { socialSphereUserId: userId, socialSpherePlan: tier },
                    });
                    if (created.id && created.status === "created") {
                        createdSubscriptionId = created.id;
                    }
                }
            } catch (err) {
                console.warn("Recurring subscription plan unavailable, falling back to Razorpay order checkout:", (err as Error).message);
            }
        }

        // Standard checkout order fallback (fully supported across all standard Razorpay accounts)
        if (!createdSubscriptionId) {
            const shortUser = userId.replace(/[^a-zA-Z0-9]/g, "").slice(-8);
            const receipt = `rcpt_${tier.toLowerCase()}_${shortUser}_${Date.now().toString(36)}`;
            const order = await razorpayRequest<RazorpayOrder>("/orders", "POST", {
                amount: expected.pricePaise,
                currency: "INR",
                receipt,
                notes: {
                    userId,
                    tier,
                    planName: expected.name,
                },
            });
            if (!order.id) {
                return res.status(502).json({ error: "Razorpay did not return a valid order ID." });
            }
            createdOrderId = order.id;
            planId = `order_${tier.toLowerCase()}`;
        }

        const identifier = createdSubscriptionId || createdOrderId;
        const finalPlanId = planId || `order_${tier.toLowerCase()}`;
        if (!identifier) {
            return res.status(502).json({ error: "Unable to establish checkout with Razorpay." });
        }

        const local = await prisma.razorpaySubscription.create({
            data: { userId, tier, razorpaySubscriptionId: identifier, razorpayPlanId: finalPlanId, status: "PENDING" },
            select: { id: true, razorpaySubscriptionId: true, tier: true },
        });

        return res.status(201).json({
            subscription: local,
            checkout: {
                keyId: razorpayKeyId(),
                ...(createdOrderId ? { orderId: createdOrderId } : { subscriptionId: createdSubscriptionId || identifier }),
                name: "SocialSphere",
                description: `${expected.name} monthly subscription`,
                amountInr: expected.priceInr,
                amountPaise: expected.pricePaise,
                currency: "INR",
                prefill: await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
            },
        });
    } catch (error) {
        const status = (error as { statusCode?: number }).statusCode || 502;
        console.error("Razorpay subscription creation failed:", (error as Error).message);
        return res.status(status).json({ error: (error as Error).message || "Unable to create a Razorpay subscription." });
    }
};

const persistCapturedOrderPayment = async (
    local: { id: string; userId: string; tier: string; razorpayPlanId: string; razorpaySubscriptionId: string },
    payment: RazorpayPayment,
) => {
    const tier = local.tier as PaidPlan;
    const expected = PLAN_CONFIG[tier];
    if (payment.amount !== expected.pricePaise || payment.currency !== "INR") return false;

    const periodStart = new Date();
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await prisma.$transaction(async (tx) => {
        await tx.razorpaySubscription.update({
            where: { id: local.id },
            data: { status: "ACTIVE", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false },
        });
        await tx.billingPayment.upsert({
            where: { razorpayPaymentId: payment.id },
            create: {
                userId: local.userId,
                razorpaySubscriptionRowId: local.id,
                razorpayPaymentId: payment.id,
                razorpaySubscriptionId: local.razorpaySubscriptionId,
                amount: payment.amount,
                currency: payment.currency,
                status: "CAPTURED",
                ...(payment.created_at ? { createdAt: new Date(payment.created_at * 1000) } : {}),
            },
            update: { status: "CAPTURED", amount: payment.amount, currency: payment.currency },
        });
        await tx.subscription.upsert({
            where: { userId: local.userId },
            create: { userId: local.userId, tier, status: "ACTIVE", startDate: periodStart, endDate: periodEnd },
            update: { tier, status: "ACTIVE", startDate: periodStart, endDate: periodEnd },
        });
        await tx.user.update({ where: { id: local.userId }, data: { isVerified: expected.verifiedBadge } });
    });

    // Mark previous active subscriptions as cancelled
    const olderActive = await prisma.razorpaySubscription.findMany({
        where: { userId: local.userId, status: "ACTIVE", id: { not: local.id } },
        select: { id: true, razorpaySubscriptionId: true },
    });
    for (const old of olderActive) {
        if (old.razorpaySubscriptionId.startsWith("sub_")) {
            try {
                await razorpayRequest(`/subscriptions/${encodeURIComponent(old.razorpaySubscriptionId)}/cancel`, "POST", { cancel_at_cycle_end: false });
            } catch (error) {
                console.error("Could not cancel previous Razorpay subscription after plan change:", (error as Error).message);
            }
        }
        await prisma.razorpaySubscription.update({ where: { id: old.id }, data: { status: "CANCELLED", cancelAtPeriodEnd: false } });
    }
    return true;
};

const persistCapturedPayment = async (
    local: { id: string; userId: string; tier: string; razorpayPlanId: string; razorpaySubscriptionId: string },
    payment: RazorpayPayment,
    remoteSubscription: RazorpaySubscription,
) => {
    const tier = local.tier as PaidPlan;
    const expected = PLAN_CONFIG[tier];
    if (remoteSubscription.id !== local.razorpaySubscriptionId || remoteSubscription.plan_id !== local.razorpayPlanId ||
        local.razorpayPlanId !== getRazorpayPlanId(tier) || remoteSubscription.status !== "active" ||
        payment.subscription_id !== local.razorpaySubscriptionId || payment.amount !== expected.pricePaise ||
        payment.currency !== "INR" || (payment.status !== "captured" && payment.captured !== true)) return false;

    const periodStart = remoteSubscription.current_start ? new Date(remoteSubscription.current_start * 1000) : new Date();
    const periodEnd = remoteSubscription.current_end ? new Date(remoteSubscription.current_end * 1000) : null;
    if (!periodEnd || periodEnd <= new Date()) return false;

    await prisma.$transaction(async (tx) => {
        await tx.razorpaySubscription.update({
            where: { id: local.id },
            data: { status: "ACTIVE", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false },
        });
        await tx.billingPayment.upsert({
            where: { razorpayPaymentId: payment.id },
            create: {
                userId: local.userId, razorpaySubscriptionRowId: local.id,
                razorpayPaymentId: payment.id, razorpaySubscriptionId: local.razorpaySubscriptionId,
                amount: payment.amount, currency: payment.currency, status: "CAPTURED",
                ...(payment.created_at ? { createdAt: new Date(payment.created_at * 1000) } : {}),
            },
            update: { status: "CAPTURED", amount: payment.amount, currency: payment.currency },
        });
        await tx.subscription.upsert({
            where: { userId: local.userId },
            create: { userId: local.userId, tier, status: "ACTIVE", startDate: periodStart, endDate: periodEnd },
            update: { tier, status: "ACTIVE", startDate: periodStart, endDate: periodEnd },
        });
        await tx.user.update({ where: { id: local.userId }, data: { isVerified: expected.verifiedBadge } });
    });

    // Switching tiers ends older active recurring mandates to prevent double renewals.
    const olderActive = await prisma.razorpaySubscription.findMany({
        where: { userId: local.userId, status: "ACTIVE", id: { not: local.id } },
        select: { id: true, razorpaySubscriptionId: true },
    });
    for (const old of olderActive) {
        try {
            await razorpayRequest(`/subscriptions/${encodeURIComponent(old.razorpaySubscriptionId)}/cancel`, "POST", { cancel_at_cycle_end: false });
            await prisma.razorpaySubscription.update({ where: { id: old.id }, data: { status: "CANCELLED", cancelAtPeriodEnd: false } });
        } catch (error) {
            console.error("Could not cancel previous Razorpay subscription after plan change:", (error as Error).message);
        }
    }
    return true;
};

export const verifySubscriptionCheckout = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        const {
            razorpay_subscription_id: subscriptionId,
            razorpay_order_id: orderId,
            razorpay_payment_id: paymentId,
            razorpay_signature: signature,
        } = req.body || {};

        if (!paymentId || !signature || (!subscriptionId && !orderId)) {
            return res.status(400).json({ error: "Razorpay checkout verification fields are required." });
        }

        // Standard Order checkout verification (works on all standard Razorpay accounts)
        if (orderId) {
            if (!verifyOrderPaymentSignature(orderId, paymentId, signature)) {
                return res.status(400).json({ error: "Razorpay checkout signature is invalid." });
            }
            const local = await prisma.razorpaySubscription.findFirst({ where: { userId, razorpaySubscriptionId: orderId } });
            if (!local) return res.status(404).json({ error: "Order does not belong to this account." });

            const payment = await razorpayRequest<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`, "GET");
            if (payment.order_id && payment.order_id !== orderId) {
                return res.status(400).json({ error: "Payment order identity did not match." });
            }
            const expected = PLAN_CONFIG[local.tier as PaidPlan];
            if (payment.amount !== expected.pricePaise || payment.currency !== "INR") {
                return res.status(400).json({ error: "Payment amount or currency does not match the selected plan." });
            }

            if (payment.status === "authorized") {
                try {
                    await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}/capture`, "POST", {
                        amount: payment.amount,
                        currency: "INR",
                    });
                    payment.status = "captured";
                } catch (captureErr) {
                    console.warn("Could not capture payment directly:", (captureErr as Error).message);
                }
            }

            const activated = await persistCapturedOrderPayment(local, payment);
            if (!activated) {
                return res.status(400).json({ error: "Payment could not be verified for activation." });
            }
            return res.json({ status: "ACTIVE", entitlements: await getUserEntitlements(userId) });
        }

        // Recurring Subscription checkout verification
        if (!verifySubscriptionCheckoutSignature(subscriptionId, paymentId, signature)) {
            return res.status(400).json({ error: "Razorpay checkout signature is invalid." });
        }
        const local = await prisma.razorpaySubscription.findFirst({ where: { userId, razorpaySubscriptionId: subscriptionId } });
        if (!local) return res.status(404).json({ error: "Subscription does not belong to this account." });
        const [remoteSubscription, payment] = await Promise.all([
            razorpayRequest<RazorpaySubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`, "GET"),
            razorpayRequest<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`, "GET"),
        ]);
        if (payment.subscription_id !== subscriptionId || remoteSubscription.id !== subscriptionId || remoteSubscription.plan_id !== local.razorpayPlanId) {
            return res.status(400).json({ error: "Payment or subscription identity did not match." });
        }
        if (payment.amount !== PLAN_CONFIG[local.tier as PaidPlan].pricePaise || payment.currency !== "INR") {
            return res.status(400).json({ error: "Payment amount or currency does not match the selected plan." });
        }
        const activated = await persistCapturedPayment(local, payment, remoteSubscription);
        if (!activated) {
            return res.status(202).json({ status: "PENDING", message: "Razorpay is still confirming the recurring payment. Your plan will activate after its verified webhook arrives." });
        }
        return res.json({ status: "ACTIVE", entitlements: await getUserEntitlements(userId) });
    } catch (error) {
        const status = (error as { statusCode?: number }).statusCode || 502;
        console.error("Razorpay callback verification failed:", (error as Error).message);
        return res.status(status).json({ error: (error as Error).message || "Unable to verify the Razorpay payment." });
    }
};

export const cancelSubscription = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        const subscription = await prisma.razorpaySubscription.findFirst({
            where: { userId, status: "ACTIVE", cancelAtPeriodEnd: false },
            orderBy: { createdAt: "desc" },
        });
        if (!subscription) return res.status(404).json({ error: "No active subscription can be cancelled." });
        if (subscription.razorpaySubscriptionId.startsWith("sub_")) {
            try {
                const remote = await razorpayRequest<RazorpaySubscription>(`/subscriptions/${encodeURIComponent(subscription.razorpaySubscriptionId)}/cancel`, "POST", { cancel_at_cycle_end: true });
                if (remote.id !== subscription.razorpaySubscriptionId) return res.status(502).json({ error: "Razorpay returned an unexpected subscription." });
            } catch (cancelErr) {
                console.warn("Could not cancel remote subscription:", (cancelErr as Error).message);
            }
        }
        const updated = await prisma.razorpaySubscription.update({
            where: { id: subscription.id }, data: { cancelAtPeriodEnd: true },
        });
        await prisma.subscription.updateMany({ where: { userId }, data: { status: "CANCELLED" } });
        return res.json({ subscription: updated, entitlements: await getUserEntitlements(userId) });
    } catch (error) {
        const status = (error as { statusCode?: number }).statusCode || 502;
        console.error("Razorpay cancellation failed:", (error as Error).message);
        return res.status(status).json({ error: (error as Error).message || "Unable to cancel the subscription." });
    }
};

export const cancelPendingSubscription = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const subscriptionId = req.params.subscriptionId as string;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });
        const pending = await prisma.razorpaySubscription.findFirst({ where: { userId, razorpaySubscriptionId: subscriptionId, status: "PENDING" } });
        if (!pending) return res.status(404).json({ error: "Pending checkout was not found for this account." });
        if (subscriptionId.startsWith("sub_")) {
            try {
                const remote = await razorpayRequest<RazorpaySubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, "POST", { cancel_at_cycle_end: false });
                if (remote.id !== subscriptionId) return res.status(502).json({ error: "Razorpay returned an unexpected subscription." });
            } catch (cancelErr) {
                console.warn("Could not cancel remote pending subscription:", (cancelErr as Error).message);
            }
        }
        await prisma.razorpaySubscription.update({ where: { id: pending.id }, data: { status: "CANCELLED", cancelAtPeriodEnd: false } });
        return res.json({ cancelled: true });
    } catch (error) {
        const status = (error as { statusCode?: number }).statusCode || 502;
        console.error("Razorpay pending checkout cancellation failed:", (error as Error).message);
        return res.status(status).json({ error: (error as Error).message || "Unable to close the pending checkout." });
    }
};

export const handleRazorpayWebhook = async (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
    const signature = req.header("x-razorpay-signature") || "";
    const eventId = req.header("x-razorpay-event-id") || "";
    if (!rawBody || !verifyWebhookSignature(rawBody, signature)) {
        return res.status(400).json({ error: "Invalid Razorpay webhook signature." });
    }
    if (!eventId) return res.status(400).json({ error: "Razorpay event ID is required." });

    let body: Record<string, any>;
    try { body = JSON.parse(rawBody.toString("utf8")) as Record<string, any>; }
    catch { return res.status(400).json({ error: "Invalid webhook JSON." }); }
    const event = typeof body.event === "string" ? body.event : "";
    if (!event) return res.status(400).json({ error: "Razorpay event name is required." });

    const eventHash = createHash("sha256").update(rawBody).digest("hex");
    try {
        await prisma.processedWebhookEvent.create({ data: { eventId, event, payload: body } });
    } catch (error) {
        if ((error as { code?: string }).code === "P2002") {
            const previous = await prisma.processedWebhookEvent.findUnique({ where: { eventId }, select: { processedAt: true } });
            if (previous?.processedAt) return res.status(200).json({ received: true, duplicate: true });
        } else {
            console.error("Could not persist Razorpay webhook:", error);
            return res.status(500).json({ error: "Webhook could not be recorded." });
        }
    }

    try {
        const subscription = body.payload?.subscription?.entity as RazorpaySubscription & Record<string, any> | undefined;
        const payment = body.payload?.payment?.entity as RazorpayPayment & Record<string, any> | undefined;
        const remoteId = subscription?.id || payment?.subscription_id || payment?.order_id || (body.payload?.order?.entity as Record<string, any> | undefined)?.id;
        if (!remoteId) {
            await prisma.processedWebhookEvent.update({ where: { eventId }, data: { processedAt: new Date() } });
            return res.status(200).json({ received: true, ignored: true });
        }
        const local = await prisma.razorpaySubscription.findUnique({ where: { razorpaySubscriptionId: remoteId } });
        if (!local) {
            // Unknown records are acknowledged and retained for audit; they never change entitlements.
            await prisma.processedWebhookEvent.update({ where: { eventId }, data: { processedAt: new Date() } });
            return res.status(200).json({ received: true, ignored: true });
        }

        // Handle order webhook events
        if (local.razorpaySubscriptionId.startsWith("order_")) {
            if ((event === "order.paid" || event === "payment.captured") && payment) {
                await persistCapturedOrderPayment(local, payment);
            }
            await prisma.processedWebhookEvent.update({ where: { eventId }, data: { processedAt: new Date() } });
            return res.status(200).json({ received: true, processed: true, eventHash });
        }

        if (subscription && (subscription.plan_id !== local.razorpayPlanId || local.razorpayPlanId !== getRazorpayPlanId(local.tier as PaidPlan))) {
            await prisma.processedWebhookEvent.update({ where: { eventId }, data: { processedAt: new Date() } });
            return res.status(200).json({ received: true, ignored: true });
        }

        const occurredAt = eventMillis(body.created_at);
        const isStale = occurredAt < local.updatedAt.getTime();
        if ((event === "subscription.charged" || event === "payment.captured") && payment) {
            const freshSubscription = await razorpayRequest<RazorpaySubscription>(`/subscriptions/${encodeURIComponent(remoteId)}`, "GET");
            await persistCapturedPayment(local, payment, freshSubscription);
        } else if (!isStale && subscription) {
            const currentStart = subscription.current_start ? new Date(subscription.current_start * 1000) : local.currentPeriodStart;
            const currentEnd = subscription.current_end ? new Date(subscription.current_end * 1000) : local.currentPeriodEnd;
            if (event === "subscription.activated") {
                await prisma.razorpaySubscription.update({ where: { id: local.id }, data: { currentPeriodStart: currentStart, currentPeriodEnd: currentEnd } });
            } else if (event === "subscription.pending") {
                await prisma.razorpaySubscription.updateMany({ where: { id: local.id, status: { not: "ACTIVE" } }, data: { status: "PENDING" } });
            } else if (event === "subscription.halted") {
                await prisma.razorpaySubscription.update({ where: { id: local.id }, data: { status: "HALTED", cancelAtPeriodEnd: false } });
                await prisma.subscription.updateMany({ where: { userId: local.userId }, data: { status: "EXPIRED" } });
                await prisma.user.update({ where: { id: local.userId }, data: { isVerified: false } });
            } else if (event === "subscription.cancelled") {
                const scheduled = Boolean(local.cancelAtPeriodEnd && currentEnd && currentEnd > new Date());
                await prisma.razorpaySubscription.update({ where: { id: local.id }, data: { status: "CANCELLED", cancelAtPeriodEnd: scheduled, currentPeriodStart: currentStart, currentPeriodEnd: currentEnd } });
                await prisma.subscription.updateMany({ where: { userId: local.userId }, data: { status: "CANCELLED" } });
            } else if (event === "subscription.completed") {
                await prisma.razorpaySubscription.update({ where: { id: local.id }, data: { status: "COMPLETED", cancelAtPeriodEnd: false, currentPeriodStart: currentStart, currentPeriodEnd: currentEnd } });
                await prisma.subscription.updateMany({ where: { userId: local.userId }, data: { status: "EXPIRED" } });
                await prisma.user.update({ where: { id: local.userId }, data: { isVerified: false } });
            }
        }

        if (payment && ["payment.failed", "payment.authorized", "payment.captured"].includes(event)) {
            const expected = PLAN_CONFIG[local.tier as PaidPlan];
            const validCurrency = payment.currency === "INR";
            await prisma.billingPayment.upsert({
                where: { razorpayPaymentId: payment.id },
                create: {
                    userId: local.userId,
                    razorpaySubscriptionRowId: local.id,
                    razorpayPaymentId: payment.id,
                    razorpaySubscriptionId: remoteId,
                    amount: payment.amount,
                    currency: payment.currency,
                    status: validCurrency && payment.amount === expected.pricePaise ? payment.status.toUpperCase() : "INVALID",
                    ...(payment.created_at ? { createdAt: new Date(payment.created_at * 1000) } : {}),
                },
                update: {
                    status: validCurrency && payment.amount === expected.pricePaise ? payment.status.toUpperCase() : "INVALID",
                },
            });
        }
        await prisma.processedWebhookEvent.update({ where: { eventId }, data: { processedAt: new Date() } });
        return res.status(200).json({ received: true, processed: true, eventHash });
    } catch (error) {
        console.error("Razorpay webhook processing failed:", (error as Error).message);
        // Leave processedAt unset: delivery retry is acknowledged as duplicate, but the retained payload can be retried administratively.
        return res.status(500).json({ error: "Webhook processing failed." });
    }
};
