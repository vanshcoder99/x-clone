import { prisma } from "../index.js";
import { PLAN_CONFIG, type AIAction, type PlanTier, isAIActionAllowed } from "./plan-config.js";

const paidTier = (tier: string): tier is "PLUS" | "PRO" => tier === "PLUS" || tier === "PRO";

const calendarPeriod = (now: Date) => ({
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
});

export const getUserEntitlements = async (userId: string) => {
    const now = new Date();
    const subscription = await prisma.razorpaySubscription.findFirst({
        where: { userId, status: { in: ["ACTIVE", "CANCELLED"] } },
        orderBy: [{ currentPeriodStart: "desc" }, { createdAt: "desc" }],
    });
    const end = subscription?.currentPeriodEnd || null;
    const subscriptionIsCurrent = Boolean(
        subscription?.razorpaySubscriptionId &&
        paidTier(subscription.tier) &&
        end && end > now &&
        (subscription.status === "ACTIVE" || (subscription.status === "CANCELLED" && subscription.cancelAtPeriodEnd))
    );
    const tier: PlanTier = subscriptionIsCurrent && paidTier(subscription!.tier)
        ? subscription!.tier
        : "FREE";
    const plan = PLAN_CONFIG[tier];
    const period = tier !== "FREE" && subscription?.currentPeriodStart && end
        ? { start: subscription.currentPeriodStart, end }
        : calendarPeriod(now);
    const usage = await prisma.aiUsagePeriod.findUnique({
        where: { userId_periodStart: { userId, periodStart: period.start } },
        select: { id: true, creditsUsed: true },
    });
    const used = usage?.creditsUsed || 0;

    return {
        tier,
        planName: plan.name,
        subscriptionStatus: subscription?.status || "ACTIVE",
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        cancelAtPeriodEnd: Boolean(subscription?.cancelAtPeriodEnd),
        monthlyCredits: plan.monthlyCredits,
        creditsUsed: used,
        creditsRemaining: Math.max(0, plan.monthlyCredits - used),
        maxPostCharacters: plan.maxPostCharacters,
        verifiedBadge: plan.verifiedBadge,
        premiumProfile: plan.premiumProfile,
        features: plan.features,
    };
};

export const requireAIEntitlement = async (userId: string, action: AIAction) => {
    const entitlements = await getUserEntitlements(userId);
    if (!isAIActionAllowed(entitlements.tier, action)) {
        const error = new Error("This AI capability requires a Plus or Pro plan.") as Error & { statusCode: number; code: string };
        error.statusCode = 403;
        error.code = "PLAN_UPGRADE_REQUIRED";
        throw error;
    }
    if (entitlements.creditsRemaining <= 0) {
        const error = new Error("You have used all AI credits for this billing period. Upgrade your plan or wait for the next cycle.") as Error & { statusCode: number; code: string };
        error.statusCode = 402;
        error.code = "AI_CREDITS_EXHAUSTED";
        throw error;
    }
    return entitlements;
};

export const getCachedAIResponse = async (userId: string, key: string) => {
    const transaction = await prisma.creditTransaction.findUnique({
        where: { idempotencyKey: `${userId}:${key}` },
        select: { response: true },
    });
    if (!transaction?.response) return null;
    try {
        return JSON.parse(transaction.response) as Record<string, unknown>;
    } catch {
        return null;
    }
};

export const consumeAICredit = async (
    userId: string,
    idempotencyKey: string,
    response: Record<string, unknown>,
) => {
    const entitlements = await getUserEntitlements(userId);
    const start = entitlements.currentPeriodStart;
    const end = entitlements.currentPeriodEnd;
    const uniqueKey = `${userId}:${idempotencyKey}`;
    const usagePeriod = await prisma.aiUsagePeriod.upsert({
        where: { userId_periodStart: { userId, periodStart: start } },
        create: { userId, periodStart: start, periodEnd: end },
        update: { periodEnd: end },
        select: { id: true },
    });

    try {
    return await prisma.$transaction(async (tx) => {
            const updated = await tx.aiUsagePeriod.updateMany({
                where: { id: usagePeriod.id, creditsUsed: { lt: entitlements.monthlyCredits } },
                data: { creditsUsed: { increment: 1 } },
            });
            if (updated.count !== 1) {
                const error = new Error("AI credits have run out. Please upgrade your plan or try again next billing period.") as Error & { statusCode: number; code: string };
                error.statusCode = 402;
                error.code = "AI_CREDITS_EXHAUSTED";
                throw error;
            }
            const freshUsage = await tx.aiUsagePeriod.findUnique({ where: { id: usagePeriod.id }, select: { creditsUsed: true } });
            const creditsUsed = freshUsage?.creditsUsed || entitlements.creditsUsed + 1;
            const responseBody = {
                ...response,
                creditsUsed,
                creditsRemaining: Math.max(0, entitlements.monthlyCredits - creditsUsed),
            };
            await tx.creditTransaction.create({
                data: {
                    userId,
                    usagePeriodId: usagePeriod.id,
                    amount: -1,
                    type: "AI_GENERATION",
                    description: "Successful OpenRouter generation",
                    idempotencyKey: uniqueKey,
                    response: JSON.stringify(responseBody),
                },
            });
            return responseBody;
        });
    } catch (error) {
        if ((error as { code?: string })?.code === "P2002") {
            const cached = await getCachedAIResponse(userId, idempotencyKey);
            if (cached) return cached;
        }
        throw error;
    }
};
