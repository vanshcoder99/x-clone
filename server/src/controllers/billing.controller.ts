import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { prisma } from "../index.js";
import type { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { getUserEntitlements } from "../lib/entitlements.js";
import { getCachedRazorpayPlanId, getRazorpayPlanId, cacheRazorpayPlanId, PAID_PLAN_ORDER, PLAN_CONFIG, type PaidPlan } from "../lib/plan-config.js";
import { razorpayKeyId, razorpayRequest, verifySubscriptionCheckoutSignature, verifyWebhookSignature } from "../lib/razorpay.js";

interface RazorpayPlan {
    id: string; period: string; interval: number;
    item?: { amount?: number; currency?: string };
}
interface RazorpaySubscription {
    id: string; plan_id: string; status: string;
    current_start?: number | null; current_end?: number | null;
}
interface RazorpayPayment {
    id: string; subscription_id?: string | null; amount: number; currency: string;
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
        let planId = getRazorpayPlanId(paidTier) || getCachedRazorpayPlanId(paidTier);
        if (!planId) {
            const storedPlan = await prisma.razorpaySubscription.findFirst({
                where: { tier: paidTier }, orderBy: { createdAt: "desc" }, select: { razorpayPlanId: true },
            });
            planId = storedPlan?.razorpayPlanId;
        }
        if (!planId) {
            const expectedPlan = PLAN_CONFIG[paidTier];
            const provisioned = await razorpayRequest<RazorpayPlan>("/plans", "POST", {
                period: "monthly", interval: 1,
                item: { name: `SocialSphere ${expectedPlan.name}`, amount: expectedPlan.pricePaise, currency: "INR", description: `${expectedPlan.name} monthly subscription` },
            });
            if (!provisioned.id) return res.status(502).json({ error: "Razorpay did not return a plan ID." });
            planId = provisioned.id;
            cacheRazorpayPlanId(paidTier, planId);
        }

        const pending = await prisma.razorpaySubscription.findFirst({ where: { userId, status: "PENDING" }, orderBy: { createdAt: "desc" } });
        if (pending) {
            if (pending.tier !== tier || pending.razorpayPlanId !== planId) {
                return res.status(409).json({ error: "A checkout is already waiting for completion. Close that checkout first, then choose another plan." });
            }
            const expected = PLAN_CONFIG[tier as PaidPlan];
            return res.status(200).json({
                subscription: { id: pending.id, razorpaySubscriptionId: pending.razorpaySubscriptionId, tier: pending.tier },
                checkout: {
                    keyId: razorpayKeyId(), subscriptionId: pending.razorpaySubscriptionId,
                    name: "SocialSphere", description: `${expected.name} monthly subscription`,
                    amountInr: expected.priceInr, currency: "INR",
                    prefill: await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
                },
            });
        }

        const expected = PLAN_CONFIG[tier as PaidPlan];
        const remotePlan = await razorpayRequest<RazorpayPlan>(`/plans/${encodeURIComponent(planId)}`, "GET");
        if (remotePlan.id !== planId || remotePlan.period !== "monthly" || remotePlan.interval !== 1 ||
            remotePlan.item?.amount !== expected.pricePaise || remotePlan.item?.currency !== "INR") {
            return res.status(503).json({ error: "The configured Razorpay plan does not match the SocialSphere monthly price. Check the Razorpay Dashboard plan and server plan ID." });
        }

        const created = await razorpayRequest<RazorpaySubscription>("/subscriptions", "POST", {
            plan_id: planId,
            total_count: 1200,
            quantity: 1,
            customer_notify: true,
            notes: { socialSphereUserId: userId, socialSpherePlan: tier },
        });
        if (!created.id || created.plan_id !== planId || created.status !== "created") {
            return res.status(502).json({ error: "Razorpay did not return a valid subscription. No plan access was changed." });
        }

        const local = await prisma.razorpaySubscription.create({
            data: { userId, tier, razorpaySubscriptionId: created.id, razorpayPlanId: planId, status: "PENDING" },
            select: { id: true, razorpaySubscriptionId: true, tier: true },
        });
        return res.status(201).json({
            subscription: local,
            checkout: {
                keyId: razorpayKeyId(),
                subscriptionId: created.id,
                name: "SocialSphere",
                description: `${expected.name} monthly subscription`,
                amountInr: expected.priceInr,
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
        const { razorpay_subscription_id: subscriptionId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
        if (![subscriptionId, paymentId, signature].every((value) => typeof value === "string" && value.length > 0)) {
            return res.status(400).json({ error: "Razorpay checkout verification fields are required." });
        }
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
        const remote = await razorpayRequest<RazorpaySubscription>(`/subscriptions/${encodeURIComponent(subscription.razorpaySubscriptionId)}/cancel`, "POST", { cancel_at_cycle_end: true });
        if (remote.id !== subscription.razorpaySubscriptionId) return res.status(502).json({ error: "Razorpay returned an unexpected subscription." });
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
        const remote = await razorpayRequest<RazorpaySubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, "POST", { cancel_at_cycle_end: false });
        if (remote.id !== subscriptionId) return res.status(502).json({ error: "Razorpay returned an unexpected subscription." });
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
        const remoteId = subscription?.id || payment?.subscription_id;
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
